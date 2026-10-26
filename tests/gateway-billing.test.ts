import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import type { SettleInput } from "../src/lib/billing/wallet";
import { clampInt } from "../src/lib/billing/wallet";
import { capCharge, PLATFORM_FEE_BPS, quoteUsage } from "../src/lib/billing/pricing";
import {
  applyChargeRefunds,
  applyDispute,
  earningsHoldDays,
  splitEarnings,
  transferWithRetry,
} from "../src/lib/billing/stripe";
import { parseModelConfig } from "../src/lib/models/config";
import {
  callBounds,
  GatewayError,
  holdMicrosFor,
  MAX_CHAT_BODY_BYTES,
  readChatRequest,
  runChat,
  upstreamBody,
  type ChatRequest,
  type Invocation,
} from "../src/server/gateway/runtime";
import { forEachPage } from "../src/server/scheduled";
import type { ModelRow, NebiusClient } from "../src/lib/compute/types";
import {
  fakeClock,
  fakeCredits,
  fakeNebius,
  fakeStores,
  makeDeps,
  makeModel,
} from "./compute-fakes";

/*
 * 呼び出しの課金 (gateway)・出金・返金の修正のテスト。Nebius・Stripe・DB は偽物。
 */

const CONSUMER = "user-consumer";
const PUBLISHER = "user-pub";
const PRICES = {
  pricePerRequestMicros: 1_000_000,
  priceInputMicros: 1_000_000_000,
  priceOutputMicros: 2_000_000_000,
};

/** 公開済みで、エンドポイントが動いているモデル */
function runningModel(overrides: Partial<ModelRow> = {}) {
  return makeModel({
    status: "published",
    visibility: "public",
    endpointId: "ep-1",
    endpointUrl: "https://ep.example",
    endpointToken: "sealed:token",
    endpointStatus: "running",
    ...PRICES,
    ...overrides,
  });
}

/** settleUsage の偽物。残高と売上を本物と同じ式で動かす */
function harness(model: ModelRow, consumerBalance: number, nebiusOverrides = {}) {
  const { credits, balances } = fakeCredits({ [CONSUMER]: consumerBalance, [PUBLISHER]: 100_000_000_000 });
  const { nebius, calls } = fakeNebius(nebiusOverrides);
  const { stores, models } = fakeStores({ models: [model] });
  const clock = fakeClock();
  const deps = makeDeps({ nebius, credits, stores, now: clock.now });
  const earnings = new Map<string, number>();
  const settled: SettleInput[] = [];
  const pending: Promise<unknown>[] = [];
  const invocation = (overrides: Partial<Invocation> = {}): Invocation => ({
    env: {} as AppEnv,
    waitUntil: (promise) => pending.push(promise),
    model,
    config: parseModelConfig(model.config)!,
    consumerUserId: CONSUMER,
    apiKeyId: "key-1",
    source: "api",
    deps,
    settleUsage: async (_env, input) => {
      settled.push(input);
      const due = input.charge.totalMicros - (input.heldMicros ?? 0);
      balances.set(input.consumerUserId, (balances.get(input.consumerUserId) ?? 0) - due);
      earnings.set(
        input.model.userId,
        (earnings.get(input.model.userId) ?? 0) + input.charge.creatorMicros,
      );
    },
    ...overrides,
  });
  const drain = async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    await Promise.all(pending);
  };
  return { invocation, balances, earnings, settled, drain, calls, models };
}

/** Nebius のエンドポイントの偽物。渡した本文を記録し、handler の返答をそのまま返す */
function fakeUpstream(handler: () => Response) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const proxyChatCompletion: NebiusClient["proxyChatCompletion"] = async (_env, input) => {
    requests.push({ url: input.endpointUrl, body: input.body });
    return handler();
  };
  return { requests, overrides: { proxyChatCompletion } };
}

const REQUEST: ChatRequest = {
  model: "support-bot",
  messages: [{ role: "user", content: "hi" }],
  max_tokens: 100,
};

/* ---------------------------------------------------------------- H1: 仮押さえを上限にする */

test("H1: 上流が莫大な usage を返しても、請求は仮押さえ (最大の額) までで残高はマイナスにならない", async () => {
  const model = runningModel();
  const bounds = callBounds(parseModelConfig(model.config)!, REQUEST);
  const hold = holdMicrosFor({ model, consumerUserId: CONSUMER }, bounds);
  const upstream = fakeUpstream(() =>
    Response.json({
      choices: [{ message: { role: "assistant", content: "ok" } }],
      usage: { prompt_tokens: 5_000_000_000, completion_tokens: 9_000_000_000 },
    }),
  );
  const { invocation, balances, earnings, settled, drain } = harness(model, hold, upstream.overrides);
  await runChat(invocation(), REQUEST);
  await drain();
  assert.equal(settled.length, 1);
  assert.equal(settled[0].inputTokens, bounds.inputTokens);
  assert.equal(settled[0].outputTokens, 100);
  assert.ok(settled[0].charge.totalMicros <= hold);
  assert.equal(balances.get(CONSUMER), hold - settled[0].charge.totalMicros);
  assert.ok((balances.get(CONSUMER) ?? -1) >= 0);
  assert.ok((earnings.get(PUBLISHER) ?? 0) <= hold);
  // 上流には上限で抑えた max_tokens を渡す
  assert.equal(upstream.requests[0].body.max_tokens, 100);
});

test("H1: max_tokens を設定の上限で抑えて必ず渡す", () => {
  const config = parseModelConfig(JSON.stringify({ maxOutputTokens: 512 }))!;
  const bounds = callBounds(config, { ...REQUEST, max_tokens: undefined });
  assert.equal(bounds.outputTokens, 512);
  assert.equal(upstreamBody({ ...REQUEST, max_tokens: 99_999 }, 512).max_tokens, 512);
  // max_completion_tokens で来ても max_tokens の名前で、上限で抑えて渡す
  const body = upstreamBody({ ...REQUEST, max_tokens: undefined, max_completion_tokens: 9_999 }, 512);
  assert.equal(body.max_tokens, 512);
  assert.equal(body.max_completion_tokens, undefined);
  // 設定に maxOutputTokens が無ければ既定の 2048
  assert.equal(parseModelConfig("{}")?.maxOutputTokens, 2048);
});

test("H1: 仮押さえは入力の上限 (本文のバイト数) と出力の上限から計算する", () => {
  const model = runningModel();
  const bounds = callBounds(parseModelConfig(model.config)!, REQUEST);
  assert.ok(bounds.inputTokens > bounds.inputBytes);
  assert.equal(
    holdMicrosFor({ model, consumerUserId: CONSUMER }, bounds),
    PRICES.pricePerRequestMicros + bounds.inputTokens * 1_000 + 100 * 2_000,
  );
  assert.equal(capCharge(quoteUsage(model, { inputTokens: 10 ** 9, outputTokens: 10 ** 9, computeMicros: 0 }), 5_000).totalMicros, 5_000);
  const capped = capCharge(quoteUsage(model, { inputTokens: 10 ** 9, outputTokens: 0, computeMicros: 0 }), 10_000);
  assert.equal(capped.creatorMicros + capped.platformFeeMicros, 10_000);
  assert.equal(capped.platformFeeMicros, Math.ceil((10_000 * PLATFORM_FEE_BPS) / 10_000));
});

test("仮押さえの入力の上限は、推論サーバーが扱える長さで頭打ちにする", () => {
  const config = parseModelConfig(runningModel().config)!;
  const long = { ...REQUEST, messages: [{ role: "user" as const, content: "a".repeat(100_000) }] };
  assert.ok(callBounds(config, long).inputTokens > 100_000);
  assert.equal(callBounds(config, long, 32_768).inputTokens, 32_768);
  // 短い本文はバイト数の見込みのまま
  assert.equal(callBounds(config, REQUEST, 32_768).inputTokens, callBounds(config, REQUEST).inputTokens);
});

/* ---------------------------------------------------------------- H2: 途中で切ったストリーム */

test("H2: usage が届く前に利用者がストリームを切っても、流した分から見積もって請求する", async () => {
  const model = runningModel();
  const encoder = new TextEncoder();
  const upstream = fakeUpstream(
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            // 本文だけ流し、usage と [DONE] は送らないまま開いておく
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "こんにちは世界" } }] })}\n\n`),
            );
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  );
  const { invocation, balances, settled, drain } = harness(model, 100_000_000_000, upstream.overrides);
  const response = await runChat(invocation(), { ...REQUEST, stream: true });
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  await drain();
  // 上流には usage を最後に返すよう頼む
  assert.deepEqual(upstream.requests[0].body.stream_options, { include_usage: true });
  assert.equal(settled.length, 1);
  assert.equal(settled[0].status, "succeeded");
  assert.equal(settled[0].outputTokens, Math.ceil(21 / 3));
  assert.ok(settled[0].inputTokens > 0);
  assert.ok(settled[0].charge.totalMicros > PRICES.pricePerRequestMicros);
  assert.ok(settled[0].charge.totalMicros <= (settled[0].heldMicros ?? 0));
  assert.equal(balances.get(CONSUMER), 100_000_000_000 - settled[0].charge.totalMicros);
});

/* ---------------------------------------------------------------- M1: 払えない呼び出しで起こさない */

test("M1: 残高の無い利用者の呼び出しでは、止まっているエンドポイントを起こさない", async () => {
  for (const prices of [PRICES, { pricePerRequestMicros: 0, priceInputMicros: 0, priceOutputMicros: 0 }]) {
    const model = makeModel({
      ...prices,
      status: "published",
      visibility: "public",
      endpointId: "ep-1",
      endpointToken: "sealed:token",
      endpointStatus: "stopped",
      endpointMicrosPerHour: 1_000_000,
    });
    const { invocation, balances, calls } = harness(model, 0);
    await assert.rejects(
      runChat(invocation(), REQUEST),
      (error) => error instanceof GatewayError && error.status === 402,
    );
    assert.equal(calls.filter((call) => call.name === "startEndpoint").length, 0);
    assert.equal(balances.get(PUBLISHER), 100_000_000_000);
  }
});

test("M1: 起動中で 503 を返すときは、利用者の仮押さえを戻す", async () => {
  const model = makeModel({
    ...PRICES,
    status: "published",
    visibility: "public",
    endpointId: "ep-1",
    endpointToken: "sealed:token",
    endpointStatus: "stopped",
    endpointMicrosPerHour: 1_000_000,
  });
  const { invocation, balances, calls } = harness(model, 100_000_000_000);
  await assert.rejects(
    runChat(invocation(), REQUEST),
    (error) => error instanceof GatewayError && error.code === "model_warming_up",
  );
  assert.equal(calls.filter((call) => call.name === "startEndpoint").length, 1);
  assert.equal(balances.get(CONSUMER), 100_000_000_000);
});

/* ---------------------------------------------------------------- L1: 本文の大きさと渡す項目 */

test("L1: 大きすぎる本文は 413、上流には許した項目だけを渡す", async () => {
  const big = JSON.stringify({ model: "m", messages: [{ role: "user", content: "x".repeat(MAX_CHAT_BODY_BYTES) }] });
  await assert.rejects(
    readChatRequest(new Request("https://x.example", { method: "POST", body: big })),
    (error) => error instanceof GatewayError && error.status === 413,
  );
  await assert.rejects(
    readChatRequest(new Request("https://x.example", { method: "POST", body: "{" })),
    (error) => error instanceof GatewayError && error.status === 400,
  );
  const parsed = await readChatRequest(
    new Request("https://x.example", {
      method: "POST",
      body: JSON.stringify({ ...REQUEST, n: 50, top_p: 0.5, guided_regex: ".*", logits_processors: ["x"] }),
    }),
  );
  const body = upstreamBody(parsed, 100);
  assert.equal(body.top_p, 0.5);
  assert.equal(body.n, undefined);
  assert.equal(body.guided_regex, undefined);
  assert.equal(body.logits_processors, undefined);
  assert.equal(body.model, undefined);
});

/* ---------------------------------------------------------------- L4: 精算の失敗と大きな数 */

test("L4: 精算に失敗したら一度やり直し、それでも駄目なら仮押さえを戻す", async () => {
  const model = runningModel();
  const upstream = fakeUpstream(() =>
    Response.json({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } }),
  );
  const { invocation, balances, drain } = harness(model, 100_000_000_000, upstream.overrides);
  let attempts = 0;
  await runChat(
    invocation({
      settleUsage: async () => {
        attempts += 1;
        throw new Error("db down");
      },
    }),
    REQUEST,
  );
  await drain();
  assert.equal(attempts, 2);
  assert.equal(balances.get(CONSUMER), 100_000_000_000);
});

test("L4: やり直しが重複 (1回目が済んでいた) なら仮押さえは戻さない。トークン数は int に収める", async () => {
  const model = runningModel();
  const upstream = fakeUpstream(() =>
    Response.json({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } }),
  );
  const { invocation, balances, drain } = harness(model, 100_000_000_000, upstream.overrides);
  const ids: string[] = [];
  let held = 0;
  const call = invocation({
    settleUsage: async (_env, input) => {
      ids.push(input.id!);
      held = input.heldMicros ?? 0;
      throw new Error(ids.length === 1 ? "connection reset" : "Duplicate entry 'x' for key 'PRIMARY'");
    },
  });
  await runChat(call, REQUEST);
  await drain();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.equal(balances.get(CONSUMER), 100_000_000_000 - held);
  assert.equal(clampInt(1e15), 2_147_483_647);
  assert.equal(clampInt(Number.NaN), 0);
  assert.equal(clampInt(-5), 0);
});

/* ---------------------------------------------------------------- M3: 出金の送金 */

const stripeError = <T extends new (raw: never) => Error>(Type: T, message: string) =>
  new Type({ message } as never);

test("M3: はっきりしない失敗は同じ冪等キーでやり直し、送れたら sent", async () => {
  let calls = 0;
  const outcome = await transferWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw stripeError(Stripe.errors.StripeConnectionError, "timeout");
    return { id: "tr_1" };
  });
  assert.deepEqual(outcome, { state: "sent", transferId: "tr_1" });
  assert.equal(calls, 2);
});

test("M3: Stripe が断ったときだけ failed (売上を戻す)。分からなければ pending (戻さない)", async () => {
  let calls = 0;
  const failed = await transferWithRetry(async () => {
    calls += 1;
    throw stripeError(Stripe.errors.StripeInvalidRequestError, "insufficient platform balance");
  });
  assert.equal(failed.state, "failed");
  assert.equal(calls, 1);

  calls = 0;
  const pending = await transferWithRetry(async () => {
    calls += 1;
    throw stripeError(Stripe.errors.StripeAPIError, "500");
  });
  assert.equal(pending.state, "pending");
  assert.equal(calls, 3);
});

/* ---------------------------------------------------------------- M4: 返金・チャージバックと売上の保留 */

type Applied = Parameters<typeof import("../src/lib/billing/wallet").applyLedgerEntry>[1];

function fakeLedger() {
  const entries: Applied[] = [];
  const apply = async (_env: AppEnv, entry: Applied) => {
    if (entries.some((other) => other.kind === entry.kind && other.referenceId === entry.referenceId)) {
      return "duplicate" as const;
    }
    entries.push(entry);
    return "applied" as const;
  };
  return { entries, apply };
}

const fakeStripe = {
  paymentIntents: {
    retrieve: async () => ({ metadata: { kind: "credit_topup", userId: CONSUMER } }),
  },
  refunds: {
    list: () =>
      (async function* () {
        yield { id: "re_1", amount: 1_000, status: "succeeded" };
        yield { id: "re_2", amount: 500, status: "pending" };
        yield { id: "re_3", amount: 700, status: "failed" };
      })(),
  },
} as unknown as Stripe;

test("M4: 返金は返金ごとに一度だけ、クレジットから引く (マイナスになってもよい)", async () => {
  const { entries, apply } = fakeLedger();
  const charge = { id: "ch_1", metadata: {}, payment_intent: "pi_1" } as unknown as Stripe.Charge;
  assert.equal(await applyChargeRefunds({} as AppEnv, fakeStripe, charge, apply), 2);
  assert.equal(await applyChargeRefunds({} as AppEnv, fakeStripe, charge, apply), 0);
  assert.deepEqual(
    entries.map((entry) => [entry.userId, entry.kind, entry.amountMicros, entry.referenceId, entry.allowNegative]),
    [
      [CONSUMER, "chargeback", -1_000_000_000, "re_1", true],
      [CONSUMER, "chargeback", -500_000_000, "re_2", true],
    ],
  );
});

test("M4: チャージバックは起きたら引き、勝ったら戻す。チャージ以外の支払いは無視する", async () => {
  const { entries, apply } = fakeLedger();
  const dispute = { id: "dp_1", amount: 3_000, metadata: {}, payment_intent: "pi_1" } as unknown as Stripe.Dispute;
  assert.equal(await applyDispute({} as AppEnv, fakeStripe, dispute, "created", apply), "applied");
  assert.equal(await applyDispute({} as AppEnv, fakeStripe, dispute, "created", apply), "duplicate");
  assert.equal(await applyDispute({} as AppEnv, fakeStripe, dispute, "won", apply), "applied");
  assert.deepEqual(entries.map((entry) => entry.amountMicros), [-3_000_000_000, 3_000_000_000]);
  const other = {
    paymentIntents: { retrieve: async () => ({ metadata: {} }) },
  } as unknown as Stripe;
  assert.equal(await applyDispute({} as AppEnv, other, dispute, "created", apply), "ignored");
});

test("M4: 直近の売上は保留にし、出金できる分から除く", () => {
  assert.equal(earningsHoldDays({}), 7);
  assert.equal(earningsHoldDays({ EARNINGS_HOLD_DAYS: "0" }), 0);
  assert.equal(earningsHoldDays({ EARNINGS_HOLD_DAYS: "x" }), 7);
  assert.deepEqual(splitEarnings(10_000, 3_000), { availableMicros: 7_000, pendingMicros: 3_000 });
  assert.deepEqual(splitEarnings(2_000, 3_000), { availableMicros: 0, pendingMicros: 2_000 });
  assert.deepEqual(splitEarnings(-500, 3_000), { availableMicros: 0, pendingMicros: 0 });
});

/* ---------------------------------------------------------------- L3: 見回りのページ送り */

test("L3: 見回りは全部のページを読み進め、時間の上限を過ぎたら次のページで止める", async () => {
  const rows = Array.from({ length: 250 }, (_, index) => index);
  const page = async (after: number | null) => rows.filter((row) => row > (after ?? -1)).slice(0, 100);
  const seen: number[] = [];
  assert.equal(
    await forEachPage(page, async (row) => seen.push(row), { pageSize: 100, deadline: Infinity }),
    250,
  );
  assert.deepEqual(seen, rows);
  let clock = 0;
  const partial = await forEachPage(page, async () => (clock += 1), {
    pageSize: 100,
    deadline: 100,
    now: () => clock,
  });
  assert.equal(partial, 100);
});
