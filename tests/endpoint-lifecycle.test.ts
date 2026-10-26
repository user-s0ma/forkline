import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCostMicros,
  endpointHoldMicros,
  microsPerHour,
} from "../src/lib/billing/compute";
import {
  deployEndpoint,
  ensureEndpointReady,
  meterEndpoint,
  stopEndpointFor,
  sweepEndpoint,
  wakeEndpoint,
} from "../src/lib/compute/endpoint";
import type { FineTuneRow, ModelRow } from "../src/lib/compute/types";
import {
  BASE_MODEL,
  fakeClock,
  fakeCredits,
  fakeNebius,
  fakeStores,
  makeDeps,
  makeModel,
} from "./compute-fakes";

const OWNER = "user-pub";
const BALANCE = 100_000_000_000;
const RATE = microsPerHour(BASE_MODEL.serveUsdPerHour);
const HOLD = endpointHoldMicros(RATE, 15);

function succeededJob(): FineTuneRow {
  const at = new Date("2026-10-24T00:00:00Z");
  return {
    id: "ft-1",
    userId: OWNER,
    modelId: "model-1",
    baseModelId: BASE_MODEL.id,
    trainPreset: BASE_MODEL.trainPreset,
    trainMicrosPerHour: microsPerHour(BASE_MODEL.trainUsdPerHour),
    datasetName: "faq.jsonl",
    datasetUri: "s3://bucket/train.jsonl",
    datasetBytes: 1000,
    datasetExamples: 10,
    datasetSource: "upload",
    datasetSummary: null,
    evalSet: null,
    evalExamples: 0,
    hyperparameters: "{}",
    nebiusJobId: "job-1",
    activeKey: null,
    status: "succeeded",
    adapterUri: "s3://bucket/adapter",
    error: null,
    estimatedMicros: 0,
    heldMicros: 0,
    costMicros: 0,
    createdAt: at,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
  };
}

function setup(model: ModelRow, nebiusOverrides: Parameters<typeof fakeNebius>[0] = {}, balance = BALANCE) {
  const { nebius, calls } = fakeNebius(nebiusOverrides);
  const { credits, balances, ledger } = fakeCredits({ [OWNER]: balance });
  const { stores, models } = fakeStores({ models: [model] });
  const clock = fakeClock();
  const deps = makeDeps({ nebius, credits, stores, now: clock.now });
  return { deps, calls, balances, ledger, models, clock };
}

/** 動いているエンドポイントを持つモデル (起動した時刻 = 時計の始まり) */
function runningModel(overrides: Partial<ModelRow> = {}) {
  const at = new Date("2026-10-24T00:00:00Z");
  return makeModel({
    baseModelId: BASE_MODEL.id,
    fineTuneId: "ft-1",
    adapterUri: "s3://bucket/adapter",
    endpointId: "ep-1",
    endpointToken: "sealed:token",
    endpointMicrosPerHour: RATE,
    endpointStatus: "running",
    endpointUrl: "https://ep-1.example",
    endpointLastUsedAt: at,
    endpointMeteredAt: at,
    endpointHeldMicros: HOLD,
    ...overrides,
  });
}

test("デプロイすると、起動と待ち時間の分を仮押さえし、トークンを暗号化して残す", async () => {
  const { deps, calls, balances, models } = setup(makeModel());
  const result = await deployEndpoint(deps, makeModel(), succeededJob());
  assert.ok(result.ok);
  const row = models.get("model-1")!;
  assert.equal(row.endpointId, "ep-1");
  assert.equal(row.endpointStatus, "starting");
  assert.equal(row.endpointToken, `sealed:${"a".repeat(64)}`);
  assert.equal(row.endpointMicrosPerHour, RATE);
  assert.equal(row.endpointHeldMicros, HOLD);
  assert.equal(row.fineTuneId, "ft-1");
  assert.equal(balances.get(OWNER), BALANCE - HOLD);
  const created = calls.find((call) => call.name === "createEndpoint")!.args[1] as {
    baseModelId: string;
    adapterUri: string;
  };
  assert.equal(created.baseModelId, BASE_MODEL.id);
  assert.equal(created.adapterUri, "s3://bucket/adapter");
});

test("学習が終わっていなければデプロイしない。残高が足りなければ断る", async () => {
  const pending = { ...succeededJob(), status: "running", adapterUri: null };
  const first = setup(makeModel());
  assert.deepEqual(await deployEndpoint(first.deps, makeModel(), pending), {
    ok: false,
    reason: "not_ready",
  });
  const poor = setup(makeModel(), {}, 10);
  const result = await deployEndpoint(poor.deps, makeModel(), succeededJob());
  assert.equal(!result.ok && result.reason, "insufficient_credits");
  assert.equal(poor.calls.length, 0);
});

test("作れなければ仮押さえを戻して失敗にする", async () => {
  const { deps, balances, models } = setup(makeModel(), {
    createEndpoint: async () => {
      throw new Error("no capacity");
    },
  });
  const result = await deployEndpoint(deps, makeModel(), succeededJob());
  assert.equal(!result.ok && result.reason, "failed");
  assert.equal(balances.get(OWNER), BALANCE);
  assert.equal(models.get("model-1")!.endpointStatus, "failed");
  assert.equal(models.get("model-1")!.endpointError, "no capacity");
});

test("Nebius が RUNNING でも、LoRA を読み込むまでは起動中として 503 を返す", async () => {
  let ready = false;
  const model = runningModel({ endpointStatus: "starting", endpointUrl: null });
  const { deps, models } = setup(model, {
    getEndpoint: async () => ({ state: "running", url: "https://ep-1.example" }),
    checkEndpointReady: async () => ready,
  });
  const first = await ensureEndpointReady(deps, model, 30);
  assert.deepEqual(first, { ready: false, reason: "warming_up", retryAfter: 30 });
  assert.equal(models.get("model-1")!.endpointStatus, "starting");
  assert.equal(models.get("model-1")!.endpointUrl, "https://ep-1.example");

  ready = true;
  const second = await ensureEndpointReady(deps, models.get("model-1")!, 30);
  assert.ok(second.ready);
  assert.equal(second.ready && second.token, "token");
  assert.equal(models.get("model-1")!.endpointStatus, "running");
});

test("止まっているエンドポイントは呼び出しで起こし、起動中を返す (起動は1回だけ)", async () => {
  const model = runningModel({
    endpointStatus: "stopped",
    endpointUrl: null,
    endpointMeteredAt: null,
    endpointHeldMicros: 0,
  });
  const { deps, calls, balances, models } = setup(model);
  const results = await Promise.all([
    ensureEndpointReady(deps, model, 30),
    ensureEndpointReady(deps, model, 30),
  ]);
  for (const result of results) {
    assert.deepEqual(result, { ready: false, reason: "warming_up", retryAfter: 30 });
  }
  assert.equal(calls.filter((call) => call.name === "startEndpoint").length, 1);
  assert.equal(balances.get(OWNER), BALANCE - HOLD);
  assert.equal(models.get("model-1")!.endpointStatus, "starting");
});

test("公開した人の残高が足りなければ起こさない", async () => {
  const model = runningModel({ endpointStatus: "stopped", endpointMeteredAt: null, endpointHeldMicros: 0 });
  const { deps, calls, models } = setup(model, {}, 0);
  const result = await ensureEndpointReady(deps, model, 30);
  assert.deepEqual(result, { ready: false, reason: "insufficient_credits" });
  assert.equal(calls.filter((call) => call.name === "startEndpoint").length, 0);
  assert.equal(models.get("model-1")!.endpointStatus, "stopped");
});

test("動いている時間を区間ごとに請求し、同じ区間を二度は請求しない", async () => {
  const model = runningModel();
  const { deps, clock, balances, ledger } = setup(model);
  clock.advance(10 * 60_000);
  const results = await Promise.all([meterEndpoint(deps, model), meterEndpoint(deps, model)]);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].kind, "endpoint");
  assert.equal(ledger[0].actualMicros, computeCostMicros(RATE, 600));
  assert.equal(balances.get(OWNER), BALANCE - computeCostMicros(RATE, 600));
  assert.ok(results.some((row) => row.endpointMeteredAt?.getTime() === clock.now().getTime()));
});

test("呼ばれないまま待ち時間を過ぎたら止め、最後の区間を請求して仮押さえを戻す", async () => {
  const model = runningModel();
  const { deps, clock, calls, balances, models } = setup(model, {
    getEndpoint: async () => ({ state: "running", url: "https://ep-1.example" }),
  });
  // 仮押さえは起動したときに引いてある
  balances.set(OWNER, BALANCE - HOLD);

  clock.advance(10 * 60_000);
  assert.equal(await sweepEndpoint(deps, models.get("model-1")!), "running");
  clock.advance(6 * 60_000);
  assert.equal(await sweepEndpoint(deps, models.get("model-1")!), "stopped_idle");

  assert.ok(calls.some((call) => call.name === "stopEndpoint"));
  const row = models.get("model-1")!;
  assert.equal(row.endpointStatus, "stopped");
  assert.equal(row.endpointMeteredAt, null);
  assert.equal(row.endpointHeldMicros, 0);
  const charged = computeCostMicros(RATE, 600) + computeCostMicros(RATE, 360);
  assert.equal(balances.get(OWNER), BALANCE - charged);
});

test("呼ばれていれば止めない", async () => {
  const model = runningModel();
  const { deps, clock, models } = setup(model, {
    getEndpoint: async () => ({ state: "running", url: "https://ep-1.example" }),
  });
  clock.advance(14 * 60_000);
  await deps.models.update("model-1", { endpointLastUsedAt: clock.now() });
  clock.advance(10 * 60_000);
  assert.equal(await sweepEndpoint(deps, models.get("model-1")!), "running");
  assert.equal(models.get("model-1")!.endpointStatus, "running");
});

test("起動中のものは起動にかかる時間を待ってから止める", async () => {
  const model = runningModel({ endpointStatus: "starting", endpointUrl: null });
  const { deps, clock, models } = setup(model);
  clock.advance(20 * 60_000);
  assert.equal(await sweepEndpoint(deps, models.get("model-1")!), "metered");
  assert.equal(models.get("model-1")!.endpointStatus, "starting");
});

test("公開した人の残高が尽きたら止める", async () => {
  const model = runningModel();
  const { deps, clock, balances, models } = setup(model, {
    getEndpoint: async () => ({ state: "running", url: "https://ep-1.example" }),
  });
  balances.set(OWNER, 0);
  clock.advance(60_000);
  assert.equal(await sweepEndpoint(deps, models.get("model-1")!), "stopped_no_credit");
  assert.equal(models.get("model-1")!.endpointStatus, "stopped");
});

test("止めるときに Nebius が失敗したら、状態を戻してエラーを残す", async () => {
  const model = runningModel();
  const { deps, models } = setup(model, {
    stopEndpoint: async () => {
      throw new Error("busy");
    },
  });
  await stopEndpointFor(deps, model);
  assert.equal(models.get("model-1")!.endpointStatus, "running");
  assert.equal(models.get("model-1")!.endpointError, "busy");
});

test("起こすのに失敗したら仮押さえを戻して止まったままにする", async () => {
  const model = runningModel({ endpointStatus: "stopped", endpointMeteredAt: null, endpointHeldMicros: 0 });
  const { deps, balances, models } = setup(model, {
    startEndpoint: async () => {
      throw new Error("quota");
    },
  });
  const result = await wakeEndpoint(deps, model);
  assert.equal(result.state, "failed");
  assert.equal(balances.get(OWNER), BALANCE);
  assert.equal(models.get("model-1")!.endpointStatus, "stopped");
});
