import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { aiModel } from "@/lib/db/schema";
import { parseModelConfig, type ModelConfig } from "@/lib/models/config";
import {
  capCharge,
  microsToYen,
  MIN_BALANCE_MICROS,
  quoteUsage,
} from "@/lib/billing/pricing";
import { ENDPOINT_RETRY_AFTER_SECONDS } from "@/lib/billing/compute";
import { isDuplicateKeyError, settleUsage, type SettleInput } from "@/lib/billing/wallet";
import { computeDeps } from "@/lib/compute/deps";
import { ensureEndpointReady } from "@/lib/compute/endpoint";
import type { ComputeDeps, ModelRow } from "@/lib/compute/types";
import { listNemotronBaseModels, type ChatUsage } from "@/lib/nebius";
import {
  createUsageTapStream,
  readUsage,
  rewriteModel,
  splitCompletionThinking,
  type TokenUsage,
} from "./sse";

export type { ModelRow };

export type Invocation = {
  env: AppEnv;
  waitUntil: (promise: Promise<unknown>) => void;
  model: ModelRow;
  /** モデルの実行の設定 (返答の上限など) */
  config: ModelConfig;
  consumerOrganizationId: string;
  apiKeyId: string | null;
  /** プレイグラウンドから呼んだ人 (API キーのときは null) */
  userId: string | null;
  /** eval は評価 (src/lib/nemotron/run-evaluation.ts) から呼んだとき */
  source: "api" | "playground" | "eval";
  /** 実行前に仮押さえした額。精算で差を清算し、0 に戻す */
  heldMicros?: number;
  /** この呼び出しで請求できるトークン数の上限 (runChat が本文から決める) */
  bounds?: CallBounds;
  /** テストで差し替えるとき以外は本番の Nebius・残高・DB */
  deps?: ComputeDeps;
  /** テストで差し替えるとき以外は settleUsage */
  settleUsage?: (env: AppEnv, input: SettleInput) => Promise<unknown>;
};

/**
 * 1回の呼び出しで請求できるトークン数の上限。仮押さえはこの上限いっぱいの額にし、
 * 上流が返したトークン数もここで抑える (請求が仮押さえを超えないため)。
 */
export type CallBounds = {
  inputTokens: number;
  outputTokens: number;
  /** 入力の本文 (messages と tools) の UTF-8 のバイト数。途中で切れたときの見積もりに使う */
  inputBytes: number;
};

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function errorResponse(error: GatewayError) {
  return Response.json(
    { error: { message: error.message, type: error.code, code: error.code } },
    { status: error.status, headers: error.headers },
  );
}

/** 公開済みのモデル、または呼び出した組織自身のモデルだけを解決する。 */
export async function resolveModel(
  env: AppEnv,
  slug: string,
  consumerOrganizationId: string,
) {
  const [model] = await getDb(env)
    .select()
    .from(aiModel)
    .where(
      and(
        eq(aiModel.slug, slug),
        or(
          and(eq(aiModel.status, "published"), eq(aiModel.visibility, "public")),
          eq(aiModel.organizationId, consumerOrganizationId),
        ),
      ),
    )
    .limit(1);
  if (!model) {
    throw new GatewayError(404, "model_not_found", `Model '${slug}' not found`);
  }
  if (model.status === "suspended") {
    throw new GatewayError(403, "model_suspended", "Model is suspended");
  }
  const config = parseModelConfig(model.config);
  if (!config) {
    throw new GatewayError(409, "model_misconfigured", "Model is not configured");
  }
  if (!model.endpointId) {
    throw new GatewayError(409, "model_not_deployed", "Model is not deployed");
  }
  return { model, config };
}

function isSelfUse(invocation: Pick<Invocation, "model" | "consumerOrganizationId">) {
  return invocation.model.organizationId === invocation.consumerOrganizationId;
}

/**
 * 呼び出しごとの料金が掛からないか。GPU 代は呼び出しごとではなく、公開した組織が動いていた時間で払うので、
 * クリエイター価格が無い (または自組織のモデルの) ときは無料
 */
export function isFree(invocation: Pick<Invocation, "model" | "consumerOrganizationId">) {
  const { model } = invocation;
  return (
    isSelfUse(invocation) ||
    (model.priceInputMicros === 0 &&
      model.priceOutputMicros === 0 &&
      model.pricePerRequestMicros === 0)
  );
}

/** 本文のほかにチャットの書式 (役割の印など) が足すトークン数の見込み */
const TEMPLATE_TOKENS = 64;
const TEMPLATE_TOKENS_PER_MESSAGE = 8;
/** 途中で切れたストリームのトークン数を、流した文字のバイト数から見積もるときの割合 */
const ESTIMATE_BYTES_PER_TOKEN = 3;

const encoder = new TextEncoder();
function utf8Bytes(text: string) {
  return encoder.encode(text).length;
}

/**
 * 入力の上限: 1トークンは1バイト以上なので、本文のバイト数と書式の分を足せば超えない。
 * さらに推論サーバーが扱える長さ (maxContextTokens) を超える入力は受け付けられないので、そこで頭打ちにする。
 * 出力の上限: 実際に上流へ渡す max_tokens (モデルの設定の上限で抑えた値)
 */
export function callBounds(
  config: ModelConfig,
  request: ChatRequest,
  maxContextTokens?: number,
): CallBounds {
  const inputBytes = utf8Bytes(
    JSON.stringify({ messages: request.messages, tools: request.tools ?? null }),
  );
  const byBytes =
    inputBytes + TEMPLATE_TOKENS + request.messages.length * TEMPLATE_TOKENS_PER_MESSAGE;
  return {
    inputBytes,
    inputTokens: maxContextTokens ? Math.min(byBytes, maxContextTokens) : byBytes,
    outputTokens: capTokens(request, config.maxOutputTokens),
  };
}

/** 上流が返したトークン数を上限までに抑える */
export function clampUsage(usage: TokenUsage, bounds: CallBounds | undefined): TokenUsage {
  const clamp = (value: number, max: number) =>
    Math.min(Math.max(0, Number.isFinite(value) ? Math.round(value) : 0), max);
  return {
    inputTokens: clamp(usage.inputTokens, bounds?.inputTokens ?? Number.MAX_SAFE_INTEGER),
    outputTokens: clamp(usage.outputTokens, bounds?.outputTokens ?? Number.MAX_SAFE_INTEGER),
  };
}

/** usage が届かないまま途中で切れたストリームのトークン数の見積もり (上限で抑える) */
export function estimateUsage(bounds: CallBounds | undefined, streamedBytes: number): TokenUsage {
  return clampUsage(
    {
      inputTokens: Math.ceil((bounds?.inputBytes ?? 0) / ESTIMATE_BYTES_PER_TOKEN),
      outputTokens: Math.ceil(Math.max(0, streamedBytes) / ESTIMATE_BYTES_PER_TOKEN),
    },
    bounds,
  );
}

/** 1回の実行で請求しうる最大の額。これを仮押さえし、請求はこれを超えない */
export function holdMicrosFor(
  invocation: Pick<Invocation, "model" | "consumerOrganizationId">,
  bounds: Pick<CallBounds, "inputTokens" | "outputTokens">,
) {
  if (isSelfUse(invocation)) return MIN_BALANCE_MICROS;
  const { model } = invocation;
  const micros =
    model.pricePerRequestMicros +
    Math.ceil((model.priceInputMicros * bounds.inputTokens) / 1_000_000) +
    Math.ceil((model.priceOutputMicros * bounds.outputTokens) / 1_000_000);
  return Math.max(MIN_BALANCE_MICROS, micros);
}

function creditsOf(invocation: Invocation) {
  return (invocation.deps ?? computeDeps(invocation.env)).credits;
}

function insufficientCredits() {
  return new GatewayError(
    402,
    "insufficient_credits",
    "Insufficient credits. Top up your balance to continue.",
  );
}

/**
 * 実行前に最大の額を仮押さえする。足りなければ 402。
 * 呼び出しごとの料金が無いモデルでも、ほかの組織からの呼び出しは残高がある組織に限る
 * (残高の無いキーで止まったエンドポイントを何度も起こし、作者に GPU 代を払わせないため)
 */
export async function assertBalance(invocation: Invocation) {
  if (isSelfUse(invocation)) return;
  const credits = creditsOf(invocation);
  if (isFree(invocation)) {
    if ((await credits.balance(invocation.consumerOrganizationId)) < MIN_BALANCE_MICROS) {
      throw insufficientCredits();
    }
    return;
  }
  const bounds = invocation.bounds ?? { inputTokens: 0, outputTokens: 0, inputBytes: 0 };
  const hold = holdMicrosFor(invocation, bounds);
  if (!(await credits.reserve(invocation.consumerOrganizationId, hold))) {
    throw insufficientCredits();
  }
  invocation.heldMicros = hold;
}

/** 精算に進まずに終わったとき (途中の例外など) の仮押さえを戻す */
export async function releaseHold(invocation: Invocation) {
  const held = invocation.heldMicros ?? 0;
  if (held <= 0) return;
  invocation.heldMicros = 0;
  await creditsOf(invocation)
    .release(invocation.consumerOrganizationId, held)
    .catch((error) =>
      console.error("仮押さえを戻せませんでした:", invocation.consumerOrganizationId, held, error),
    );
}

async function releaseOnError<T>(invocation: Invocation, run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    await releaseHold(invocation);
    throw error;
  }
}

export function settle(
  invocation: Invocation,
  outcome: { succeeded: boolean; usage: TokenUsage | null; startedAt: number },
) {
  const usage = outcome.usage ? clampUsage(outcome.usage, invocation.bounds) : null;
  const heldMicros = invocation.heldMicros ?? 0;
  const quoted = outcome.succeeded
    ? quoteUsage(
        invocation.model,
        {
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          computeMicros: 0,
        },
        { selfUse: isSelfUse(invocation) },
      )
    : quoteUsage(
        invocation.model,
        { inputTokens: 0, outputTokens: 0, computeMicros: 0 },
        { selfUse: true },
      );
  // 請求は仮押さえした額まで (仮押さえの無い無料の呼び出しは 0 のまま)
  const charge = isFree(invocation) ? quoted : capCharge(quoted, heldMicros);
  // 仮押さえはこの精算で清算するので、以後は戻さない
  invocation.heldMicros = 0;
  const input: SettleInput = {
    id: crypto.randomUUID(),
    heldMicros,
    model: invocation.model,
    consumerOrganizationId: invocation.consumerOrganizationId,
    apiKeyId: invocation.apiKeyId,
    userId: invocation.userId,
    source: invocation.source,
    status: outcome.succeeded ? "succeeded" : "failed",
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    latencyMs: Date.now() - outcome.startedAt,
    charge,
  };
  const run = invocation.settleUsage ?? settleUsage;
  // 利用ログの ID を決めてあるので、やり直しても二重には精算しない (2回目が重複なら1回目が済んでいる)
  const attempt = () =>
    run(invocation.env, input).catch((error: unknown) => {
      if (isDuplicateKeyError(error)) return;
      throw error;
    });
  const promise = attempt()
    .catch(attempt)
    .catch(async (error: unknown) => {
      console.error("利用料の精算に失敗しました:", invocation.model.slug, error);
      // 精算できなかった仮押さえは戻す (記録の無いまま残高から引かれたままにしない)
      if (heldMicros > 0) {
        await creditsOf(invocation)
          .release(invocation.consumerOrganizationId, heldMicros)
          .catch((releaseError: unknown) =>
            console.error("仮押さえを戻せませんでした:", invocation.consumerOrganizationId, releaseError),
          );
      }
    });
  return { charge, promise };
}

function withCostHeaders(response: Response, totalMicros: number) {
  const headers = new Headers(response.headers);
  headers.set("X-Forkline-Cost-JPY", String(microsToYen(totalMicros)));
  return new Response(response.body, { status: response.status, headers });
}

/** chat/completions の本文の上限 (バイト) */
export const MAX_CHAT_BODY_BYTES = 1024 * 1024;

/** 上流に渡す項目。これ以外 (n や vLLM 独自の項目など) は渡さない */
export const PASSTHROUGH_FIELDS = [
  "temperature",
  "top_p",
  "stop",
  "presence_penalty",
  "frequency_penalty",
  "seed",
  "response_format",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "user",
] as const;

/** 本文を大きさの上限つきで読み、検証する */
export async function readChatRequest(request: Request): Promise<ChatRequest> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_CHAT_BODY_BYTES) {
    throw new GatewayError(413, "request_too_large", "Request body is too large");
  }
  const text = await request.text().catch(() => "");
  if (utf8Bytes(text) > MAX_CHAT_BODY_BYTES) {
    throw new GatewayError(413, "request_too_large", "Request body is too large");
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const parsed = chatRequestSchema.safeParse(json);
  if (!parsed.success) {
    throw new GatewayError(400, "invalid_request", "Invalid chat completion request");
  }
  return parsed.data;
}

/**
 * 上流 (vLLM) に渡す本文。許した項目だけを写し、max_tokens は上限で抑えた値にする
 * (max_completion_tokens で送ってきても max_tokens の名前で渡す)
 */
export function upstreamBody(request: ChatRequest, maxTokens: number) {
  const body: Record<string, unknown> = { messages: request.messages, max_tokens: maxTokens };
  const source = request as Record<string, unknown>;
  for (const field of PASSTHROUGH_FIELDS) {
    if (source[field] !== undefined) body[field] = source[field];
  }
  return body;
}

const messageSchema = z
  .object({
    role: z.enum(["system", "developer", "user", "assistant", "tool"]),
    content: z.union([z.string(), z.array(z.unknown()), z.null()]),
  })
  .passthrough();

export const chatRequestSchema = z
  .object({
    model: z.string().min(1).max(64),
    messages: z.array(messageSchema).min(1).max(500),
    stream: z.boolean().optional(),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    tools: z.array(z.unknown()).max(128).optional(),
  })
  .passthrough();

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export function capTokens(request: ChatRequest, limit: number) {
  const requested = request.max_completion_tokens ?? request.max_tokens ?? limit;
  return Math.min(requested, limit);
}

async function upstreamError(response: Response) {
  const text = await response.text().catch(() => "");
  let message = `Upstream error (${response.status})`;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed.error?.message) message = parsed.error.message;
  } catch {
    if (text) message = text.slice(0, 300);
  }
  return new GatewayError(
    response.status >= 500 ? 502 : response.status,
    "upstream_error",
    message,
  );
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache",
};

/**
 * 上流の返答を利用者に返す形にそろえて精算する。
 * reportedUsage は上流が別に知らせたトークン数 (Nebius の onUsage)。あれば本文の usage より優先する
 */
async function relayCompletion(
  invocation: Invocation,
  response: Response,
  stream: boolean,
  startedAt: number,
  reportedUsage: () => TokenUsage | null,
) {
  if (!response.ok) {
    invocation.waitUntil(settle(invocation, { succeeded: false, usage: null, startedAt }).promise);
    throw await upstreamError(response);
  }
  if (stream && response.body) {
    const tap = createUsageTapStream(invocation.model.slug, (usage, completed, streamed) => {
      let finalUsage = reportedUsage() ?? usage;
      // usage が届く前に切れた (利用者が途中でやめた・上流が落ちた) ときは、流した分から見積もって請求する
      if (!finalUsage && streamed.contentBytes > 0) {
        finalUsage = estimateUsage(invocation.bounds, streamed.contentBytes);
      }
      const { charge, promise } = settle(invocation, {
        succeeded: completed || finalUsage !== null,
        usage: finalUsage,
        startedAt,
      });
      invocation.waitUntil(promise);
      return microsToYen(charge.totalMicros);
    });
    return new Response(response.body.pipeThrough(tap), { headers: SSE_HEADERS });
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const usage = reportedUsage() ?? readUsage(payload);
  const { charge, promise } = settle(invocation, { succeeded: true, usage, startedAt });
  invocation.waitUntil(promise);
  return withCostHeaders(
    Response.json(rewriteModel(splitCompletionThinking(payload), invocation.model.slug)),
    charge.totalMicros,
  );
}

export function toGatewayError(error: unknown) {
  if (error instanceof GatewayError) return error;
  console.error(error);
  return new GatewayError(502, "upstream_error", "Model execution failed");
}

/** 最終利用日時の更新をこの間隔に間引く (呼び出しのたびに書き込まないため) */
const LAST_USED_THROTTLE_MS = 30_000;

/** Nebius のエンドポイントが答えられる状態か確かめ、止まっていれば起こして 503 を返す */
async function nebiusTarget(invocation: Invocation) {
  const deps = invocation.deps ?? computeDeps(invocation.env);
  const ready = await ensureEndpointReady(deps, invocation.model, ENDPOINT_RETRY_AFTER_SECONDS);
  if (ready.ready) {
    const lastUsed = invocation.model.endpointLastUsedAt?.getTime() ?? 0;
    if (Date.now() - lastUsed > LAST_USED_THROTTLE_MS) {
      invocation.waitUntil(
        deps.models
          .update(invocation.model.id, { endpointLastUsedAt: new Date() })
          .catch((error) => console.error("最終利用日時を更新できませんでした:", error)),
      );
    }
    return { deps, url: ready.url, token: ready.token };
  }
  if (ready.reason === "warming_up") {
    throw new GatewayError(
      503,
      "model_warming_up",
      `The model is starting up. Retry in about ${ready.retryAfter} seconds.`,
      { "Retry-After": String(ready.retryAfter) },
    );
  }
  if (ready.reason === "insufficient_credits" && isSelfUse(invocation)) {
    throw new GatewayError(
      402,
      "insufficient_credits",
      "Insufficient credits to start this model's endpoint. Top up your balance to continue.",
    );
  }
  // 公開した組織の残高が尽きているときも、利用者には「いまは使えない」とだけ伝える
  throw new GatewayError(503, "model_unavailable", "The model is temporarily unavailable.");
}

export async function runChat(invocation: Invocation, request: ChatRequest) {
  const bounds = callBounds(
    invocation.config,
    request,
    listNemotronBaseModels().find((m) => m.id === invocation.model.baseModelId)
      ?.maxContextTokens,
  );
  invocation.bounds = bounds;
  // 払えない呼び出しでエンドポイントを起こさないよう、残高を先に確かめる
  await assertBalance(invocation);
  return releaseOnError(invocation, async () => {
    const target = await nebiusTarget(invocation);
    const startedAt = Date.now();
    const stream = request.stream === true;
    const body = upstreamBody(request, bounds.outputTokens);
    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }
    let reported: TokenUsage | null = null;
    let response: Response;
    try {
      response = await target.deps.nebius.proxyChatCompletion(invocation.env, {
        endpointUrl: target.url,
        endpointToken: target.token,
        body,
        onUsage: (usage: ChatUsage) => {
          // 途中で切れたときは 0 が届くので、数が入っているときだけ使う
          if (usage.inputTokens > 0 || usage.outputTokens > 0) reported = usage;
        },
      });
    } catch (error) {
      invocation.waitUntil(settle(invocation, { succeeded: false, usage: null, startedAt }).promise);
      throw toGatewayError(error);
    }
    return relayCompletion(invocation, response, stream, startedAt, () => reported);
  });
}
