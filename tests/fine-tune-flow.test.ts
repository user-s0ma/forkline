import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCostMicros,
  microsPerHour,
  TRAIN_MAX_SECONDS,
} from "../src/lib/billing/compute";
import {
  cancelFineTune,
  FINE_TUNE_ERRORS,
  refreshFineTune,
  startFineTune,
} from "../src/lib/compute/fine-tune";
import {
  BASE_MODEL,
  fakeClock,
  fakeCredits,
  fakeNebius,
  fakeStores,
  makeDeps,
  sampleJsonl,
} from "./compute-fakes";

const HYPERPARAMETERS = { epochs: 2, learningRate: 0.0002, loraRank: 16, loraAlpha: 32 };
const ORG = "org-pub";
const START_BALANCE = 100_000_000_000;

function setup(nebiusOverrides: Parameters<typeof fakeNebius>[0] = {}, balance = START_BALANCE) {
  const { nebius, calls } = fakeNebius(nebiusOverrides);
  const { credits, balances, ledger } = fakeCredits({ [ORG]: balance });
  const { stores, fineTunes } = fakeStores();
  const clock = fakeClock();
  const deps = makeDeps({ nebius, credits, stores, now: clock.now });
  return { deps, calls, balances, ledger, fineTunes, clock };
}

function start(deps: ReturnType<typeof setup>["deps"], jsonl = sampleJsonl()) {
  return startFineTune(deps, {
    organizationId: ORG,
    modelId: "model-1",
    createdBy: "user-1",
    baseModel: BASE_MODEL,
    datasetName: "faq.jsonl",
    jsonl,
    hyperparameters: HYPERPARAMETERS,
  });
}

test("学習を始めると見積もりの1.5倍を仮押さえし、データを置いて Job を始める", async () => {
  const { deps, calls, balances, fineTunes } = setup();
  const result = await start(deps);
  assert.ok(result.ok);
  const row = result.row;
  assert.equal(row.status, "queued");
  assert.equal(row.nebiusJobId, "job-1");
  assert.equal(row.datasetExamples, 10);
  assert.equal(row.trainMicrosPerHour, microsPerHour(BASE_MODEL.trainUsdPerHour));
  assert.equal(row.heldMicros, Math.ceil(row.estimatedMicros * 1.5));
  assert.equal(balances.get(ORG), START_BALANCE - row.heldMicros);
  assert.deepEqual(
    calls.map((call) => call.name),
    ["uploadTrainingData", "startFineTune"],
  );
  // 学習データと LoRA の置き場所は組織と学習ごとに分ける
  const upload = calls[0].args[1] as { key: string };
  assert.equal(upload.key, `organizations/${ORG}/fine-tunes/${row.id}/train.jsonl`);
  const job = calls[1].args[1] as { outputPrefix: string; datasetUri: string };
  assert.equal(job.datasetUri, "s3://bucket/train.jsonl");
  assert.equal(job.outputPrefix, `organizations/${ORG}/fine-tunes/${row.id}/adapter/`);
  assert.equal(fineTunes.get(row.id)?.nebiusJobId, "job-1");
});

test("残高が足りなければ始めず、Nebius も呼ばない", async () => {
  const { deps, calls, balances } = setup({}, 1_000);
  const result = await start(deps);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "insufficient_credits");
  assert.equal(balances.get(ORG), 1_000);
  assert.equal(calls.length, 0);
});

test("学習データが正しくなければ、仮押さえせずに断る", async () => {
  const { deps, balances } = setup();
  const result = await start(deps, '{"messages": []}\nnot json');
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "invalid_dataset");
  assert.equal(balances.get(ORG), START_BALANCE);
});

test("Job を始められなければ失敗にして、仮押さえを全部戻す", async () => {
  const { deps, balances, fineTunes, ledger } = setup({
    startFineTune: async () => {
      throw new Error("quota exceeded");
    },
  });
  const result = await start(deps);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "start_failed");
  assert.equal(balances.get(ORG), START_BALANCE);
  assert.equal(ledger.length, 0);
  const row = [...fineTunes.values()][0];
  assert.equal(row.status, "failed");
  assert.equal(row.error, "quota exceeded");
  assert.equal(row.heldMicros, 0);
});

test("queued → running → succeeded と進み、終わったら実際の時間で精算する", async () => {
  let state: "queued" | "running" | "succeeded" = "queued";
  const { deps, clock, balances, ledger, fineTunes } = setup({
    getFineTune: async () =>
      state === "succeeded"
        ? { state, adapterUri: "s3://bucket/adapter" }
        : { state },
  });
  const started = await start(deps);
  assert.ok(started.ok);
  let row = started.row;

  clock.advance(60_000);
  row = await refreshFineTune(deps, row);
  assert.equal(row.status, "queued");

  state = "running";
  clock.advance(60_000);
  row = await refreshFineTune(deps, row);
  assert.equal(row.status, "running");
  assert.equal(fineTunes.get(row.id)?.status, "running");

  state = "succeeded";
  clock.advance(18 * 60_000);
  row = await refreshFineTune(deps, row);
  assert.equal(row.status, "succeeded");
  assert.equal(row.adapterUri, "s3://bucket/adapter");
  // 始めてから終わったのを見つけるまでの20分を、始めたときの単価で精算する
  const expected = computeCostMicros(started.row.trainMicrosPerHour, 20 * 60);
  assert.equal(row.costMicros, expected);
  assert.equal(row.heldMicros, 0);
  assert.equal(balances.get(ORG), START_BALANCE - expected);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].kind, "training");
  assert.equal(ledger[0].referenceId, row.id);

  // もう一度見回っても二重に引かない
  const again = await refreshFineTune(deps, row);
  assert.equal(again.status, "succeeded");
  assert.equal(balances.get(ORG), START_BALANCE - expected);
});

test("同じ学習を同時に見回っても、精算は一度だけ", async () => {
  const { deps, clock, balances, ledger } = setup({
    getFineTune: async () => ({ state: "failed", error: "OOM" }),
  });
  const started = await start(deps);
  assert.ok(started.ok);
  clock.advance(10 * 60_000);
  await Promise.all([refreshFineTune(deps, started.row), refreshFineTune(deps, started.row)]);
  assert.equal(ledger.length, 1);
  assert.equal(
    balances.get(ORG),
    START_BALANCE - computeCostMicros(started.row.trainMicrosPerHour, 10 * 60),
  );
});

test("失敗した学習も、使った GPU の分だけ請求して残りを戻す", async () => {
  const { deps, clock, balances, fineTunes } = setup({
    getFineTune: async () => ({ state: "failed", error: "training crashed" }),
  });
  const started = await start(deps);
  assert.ok(started.ok);
  clock.advance(5 * 60_000);
  const row = await refreshFineTune(deps, started.row);
  assert.equal(row.status, "failed");
  assert.equal(row.error, "training crashed");
  assert.equal(fineTunes.get(row.id)?.status, "failed");
  assert.equal(
    balances.get(ORG),
    START_BALANCE - computeCostMicros(started.row.trainMicrosPerHour, 5 * 60),
  );
});

test("見積もりより長くかかった分は追加で引く (残高がマイナスになることもある)", async () => {
  let state: "running" | "succeeded" = "running";
  const { deps, clock, balances } = setup({
    getFineTune: async () =>
      state === "running" ? { state } : { state, adapterUri: "s3://bucket/a" },
  });
  const started = await start(deps);
  assert.ok(started.ok);
  const seconds = 3 * 60 * 60;
  clock.advance(seconds * 1000);
  state = "succeeded";
  const row = await refreshFineTune(deps, started.row);
  assert.ok(row.costMicros > started.row.heldMicros);
  assert.equal(balances.get(ORG), START_BALANCE - row.costMicros);
});

test("中止すると Nebius の Job を止め、そこまでの分を精算する", async () => {
  const { deps, clock, calls, balances } = setup();
  const started = await start(deps);
  assert.ok(started.ok);
  clock.advance(2 * 60_000);
  const row = await cancelFineTune(deps, started.row);
  assert.equal(row.status, "canceled");
  assert.ok(calls.some((call) => call.name === "cancelFineTune" && call.args[1] === "job-1"));
  assert.equal(
    balances.get(ORG),
    START_BALANCE - computeCostMicros(started.row.trainMicrosPerHour, 2 * 60),
  );
  // 終わった学習はもう一度中止しても何も起きない
  assert.equal((await cancelFineTune(deps, row)).status, "canceled");
});

test("打ち切り時間を過ぎた学習は止めて失敗にする", async () => {
  const { deps, clock, calls } = setup();
  const started = await start(deps);
  assert.ok(started.ok);
  clock.advance((TRAIN_MAX_SECONDS + 60) * 1000);
  const row = await refreshFineTune(deps, started.row);
  assert.equal(row.status, "failed");
  assert.equal(row.error, FINE_TUNE_ERRORS.timedOut);
  assert.ok(calls.some((call) => call.name === "cancelFineTune"));
});

test("Nebius に問い合わせられないときは、状態を変えずに次の見回りを待つ", async () => {
  const { deps, clock, balances } = setup({
    getFineTune: async () => {
      throw new Error("network");
    },
  });
  const started = await start(deps);
  assert.ok(started.ok);
  clock.advance(60_000);
  const row = await refreshFineTune(deps, started.row);
  assert.equal(row.status, "queued");
  assert.equal(balances.get(ORG), START_BALANCE - started.row.heldMicros);
});
