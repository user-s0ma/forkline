import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCostMicros,
  endpointHoldMicros,
  microsPerHour,
} from "../src/lib/billing/compute";
import {
  deployEndpoint,
  meterEndpoint,
  refreshEndpoint,
  removeEndpoint,
  stopEndpointFor,
  STOPPED_WHILE_STARTING_GRACE_MS,
  wakeEndpoint,
} from "../src/lib/compute/endpoint";
import {
  cancelFineTune,
  refreshFineTune,
  startFineTune,
} from "../src/lib/compute/fine-tune";
import type { FineTuneRow, ModelRow } from "../src/lib/compute/types";
import {
  BASE_MODEL,
  fakeClock,
  fakeCredits,
  fakeNebius,
  fakeStores,
  makeDeps,
  makeModel,
  sampleJsonl,
} from "./compute-fakes";

/*
 * 同時に呼ばれたとき・途中で失敗したときに、仮押さえと請求が二重にも抜けにもならないことを確かめる。
 */

const ORG = "org-pub";
const BALANCE = 100_000_000_000;
const RATE = microsPerHour(BASE_MODEL.serveUsdPerHour);
const HOLD = endpointHoldMicros(RATE, 15);
const T0 = new Date("2026-10-24T00:00:00Z");

function setup(
  initial: { models?: ModelRow[]; fineTunes?: FineTuneRow[] },
  nebiusOverrides: Parameters<typeof fakeNebius>[0] = {},
  balance = BALANCE,
) {
  const { nebius, calls } = fakeNebius(nebiusOverrides);
  const { credits, balances, ledger } = fakeCredits({ [ORG]: balance });
  const { stores, models, fineTunes } = fakeStores(initial);
  const clock = fakeClock();
  const deps = makeDeps({ nebius, credits, stores, now: clock.now });
  return { deps, calls, balances, ledger, models, fineTunes, clock, stores };
}

function stoppedModel(overrides: Partial<ModelRow> = {}) {
  return makeModel({
    baseModelId: BASE_MODEL.id,
    fineTuneId: "ft-1",
    adapterUri: "s3://bucket/adapter",
    endpointId: "ep-1",
    endpointToken: "sealed:token",
    endpointMicrosPerHour: RATE,
    endpointStatus: "stopped",
    ...overrides,
  });
}

function runningModel(overrides: Partial<ModelRow> = {}) {
  return stoppedModel({
    endpointStatus: "running",
    endpointUrl: "https://ep-1.example",
    endpointLastUsedAt: T0,
    endpointMeteredAt: T0,
    endpointHeldMicros: HOLD,
    ...overrides,
  });
}

function succeededJob(): FineTuneRow {
  return {
    id: "ft-1",
    organizationId: ORG,
    modelId: "model-1",
    createdBy: "user-1",
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
    createdAt: T0,
    startedAt: T0,
    completedAt: T0,
    updatedAt: T0,
  };
}

/* ---------------------------------------------------------------- H4: 起こす・止める */

test("H4: 起こすときの仮押さえは状態と一緒に記録し、古い行から止めても戻す", async () => {
  const model = stoppedModel();
  const { deps, balances, models, clock } = setup({ models: [model] });
  const woke = await wakeEndpoint(deps, model);
  assert.equal(woke.state, "starting");
  assert.equal(models.get("model-1")!.endpointHeldMicros, HOLD);
  assert.equal(balances.get(ORG), BALANCE - HOLD);

  // 起こす前に読んだ行 (仮押さえ 0) のまま止める
  clock.advance(60_000);
  const stale = { ...model, endpointStatus: "starting", endpointMeteredAt: T0, endpointHeldMicros: 0 };
  await stopEndpointFor(deps, stale);
  const row = models.get("model-1")!;
  assert.equal(row.endpointStatus, "stopped");
  assert.equal(row.endpointHeldMicros, 0);
  assert.equal(balances.get(ORG), BALANCE - computeCostMicros(RATE, 60));
});

test("H4: 起動を頼んだ直後に Nebius が STOPPED を返しても、止まったことにしない", async () => {
  const model = stoppedModel();
  const { deps, balances, models, clock } = setup({ models: [model] }, {
    getEndpoint: async () => ({ state: "stopped" as const }),
  });
  await wakeEndpoint(deps, model);
  clock.advance(60_000);
  await refreshEndpoint(deps, models.get("model-1")!);
  assert.equal(models.get("model-1")!.endpointStatus, "starting");
  assert.equal(models.get("model-1")!.endpointHeldMicros, HOLD);
  assert.equal(balances.get(ORG), BALANCE - HOLD);

  // 猶予を過ぎても STOPPED なら、本当に止まったものとして精算する
  clock.advance(STOPPED_WHILE_STARTING_GRACE_MS);
  await refreshEndpoint(deps, models.get("model-1")!);
  assert.equal(models.get("model-1")!.endpointStatus, "stopped");
  const seconds = (60_000 + STOPPED_WHILE_STARTING_GRACE_MS) / 1000;
  assert.equal(balances.get(ORG), BALANCE - computeCostMicros(RATE, seconds));
});

test("H4: 起動に失敗したら、自分が書いた起動中のときだけ戻す", async () => {
  const model = stoppedModel();
  const { deps, balances, models } = setup({ models: [model] }, {
    startEndpoint: async () => {
      throw new Error("quota");
    },
  });
  const results = await Promise.all([wakeEndpoint(deps, model), wakeEndpoint(deps, model)]);
  assert.deepEqual(results.map((result) => result.state).sort(), ["failed", "unchanged"]);
  assert.equal(models.get("model-1")!.endpointStatus, "stopped");
  assert.equal(balances.get(ORG), BALANCE);
});

test("H4: 消すときは、いまの行に記録してある仮押さえを戻す", async () => {
  const model = runningModel();
  const { deps, balances, models } = setup({ models: [model] });
  balances.set(ORG, BALANCE - HOLD);
  // 古い行 (仮押さえ 0、止まっている) から消しても、記録してある仮押さえは戻る
  await removeEndpoint(deps, { ...model, endpointStatus: "stopped", endpointHeldMicros: 0 });
  assert.equal(models.get("model-1")!.endpointStatus, "none");
  assert.equal(balances.get(ORG), BALANCE);
});

/* ---------------------------------------------------------------- H5: デプロイ */

test("H5: 同時のデプロイは1つだけ進み、エンドポイントも仮押さえも1つだけ", async () => {
  const model = makeModel();
  const { deps, calls, balances, models } = setup({ models: [model] });
  const results = await Promise.all([
    deployEndpoint(deps, model, succeededJob()),
    deployEndpoint(deps, model, succeededJob()),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.ok(results.some((result) => !result.ok && result.reason === "busy"));
  assert.equal(calls.filter((call) => call.name === "createEndpoint").length, 1);
  assert.equal(balances.get(ORG), BALANCE - HOLD);
  assert.equal(models.get("model-1")!.endpointStatus, "starting");
  assert.equal(models.get("model-1")!.endpointHeldMicros, HOLD);
});

test("H5: 作った後に割り込まれたら、作ったエンドポイントを消して仮押さえを戻す", async () => {
  const model = makeModel();
  let rows: Map<string, ModelRow> | null = null;
  const { deps, calls, balances, models } = setup({ models: [model] }, {
    createEndpoint: async () => {
      // 作っている間に、別の操作 (削除) が行を書き換えた
      rows!.set("model-1", { ...rows!.get("model-1")!, endpointStatus: "none" });
      return { endpointId: "ep-2", authToken: "b".repeat(64) };
    },
  });
  rows = models;
  const result = await deployEndpoint(deps, model, succeededJob());
  assert.equal(!result.ok && result.reason, "busy");
  assert.deepEqual(
    calls.filter((call) => call.name === "deleteEndpoint").map((call) => call.args[1]),
    ["ep-2"],
  );
  assert.equal(balances.get(ORG), BALANCE);
  assert.equal(models.get("model-1")!.endpointId, null);
});

test("H5: 動いているものを載せ替えると、前の最後の区間を請求して仮押さえを戻す", async () => {
  const model = runningModel();
  const { deps, calls, balances, ledger, models, clock } = setup({ models: [model] }, {
    createEndpoint: async () => ({ endpointId: "ep-2", authToken: "b".repeat(64) }),
  });
  balances.set(ORG, BALANCE - HOLD);
  clock.advance(10 * 60_000);
  const result = await deployEndpoint(deps, model, succeededJob());
  assert.ok(result.ok);
  assert.ok(calls.some((call) => call.name === "deleteEndpoint" && call.args[1] === "ep-1"));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].actualMicros, computeCostMicros(RATE, 600));
  assert.equal(models.get("model-1")!.endpointId, "ep-2");
  assert.equal(balances.get(ORG), BALANCE - computeCostMicros(RATE, 600) - HOLD);
});

test("H5: 残高が足りなければ元の状態に戻す", async () => {
  const model = makeModel();
  const { deps, models } = setup({ models: [model] }, {}, 10);
  const result = await deployEndpoint(deps, model, succeededJob());
  assert.equal(!result.ok && result.reason, "insufficient_credits");
  assert.equal(models.get("model-1")!.endpointStatus, "none");
});

test("H5: 途中で落ちて deploying のまま残った行は、しばらくたてば次のデプロイが引き継ぐ", async () => {
  const model = makeModel({ endpointStatus: "deploying", endpointLastUsedAt: T0 });
  const { deps, models, clock } = setup({ models: [model] });
  clock.advance(60_000);
  const early = await deployEndpoint(deps, model, succeededJob());
  assert.equal(!early.ok && early.reason, "busy");
  clock.advance(15 * 60_000);
  const late = await deployEndpoint(deps, models.get("model-1")!, succeededJob());
  assert.ok(late.ok);
  assert.equal(models.get("model-1")!.endpointStatus, "starting");
});

/* ---------------------------------------------------------------- M6: 区間の請求 */

test("M6: 請求に失敗したら区間の起点を進めず、次の見回りでまとめて請求する", async () => {
  const model = runningModel();
  const { deps, ledger, models, clock } = setup({ models: [model] });
  const settle = deps.credits.settle;
  let fail = true;
  deps.credits.settle = async (input) => {
    if (fail) {
      fail = false;
      throw new Error("db down");
    }
    return settle(input);
  };
  clock.advance(10 * 60_000);
  await meterEndpoint(deps, models.get("model-1")!);
  assert.equal(ledger.length, 0);
  assert.equal(models.get("model-1")!.endpointMeteredAt?.getTime(), T0.getTime());

  clock.advance(5 * 60_000);
  await meterEndpoint(deps, models.get("model-1")!);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].actualMicros, computeCostMicros(RATE, 900));
  assert.equal(models.get("model-1")!.endpointMeteredAt?.getTime(), clock.now().getTime());
});

test("M6: 止めるときに最後の区間を請求できなければ、止まったことにせず次の見回りに残す", async () => {
  const model = runningModel();
  const { deps, balances, models, clock } = setup({ models: [model] }, {
    getEndpoint: async () => ({ state: "stopped" as const }),
  });
  balances.set(ORG, BALANCE - HOLD);
  const settle = deps.credits.settle;
  deps.credits.settle = async () => {
    throw new Error("db down");
  };
  clock.advance(60_000);
  await stopEndpointFor(deps, model);
  assert.equal(models.get("model-1")!.endpointStatus, "stopping");
  assert.equal(models.get("model-1")!.endpointHeldMicros, HOLD);

  // 次の見回りで Nebius の STOPPED を見て、最後の区間を請求してから仮押さえを戻す
  deps.credits.settle = settle;
  await refreshEndpoint(deps, models.get("model-1")!);
  assert.equal(models.get("model-1")!.endpointStatus, "stopped");
  assert.equal(balances.get(ORG), BALANCE - computeCostMicros(RATE, 60));
});

/* ---------------------------------------------------------------- 学習 (H3, M5, L2) */

const HYPERPARAMETERS = { epochs: 2, learningRate: 0.0002, loraRank: 16, loraAlpha: 32 };

function start(deps: ReturnType<typeof setup>["deps"]) {
  return startFineTune(deps, {
    organizationId: ORG,
    modelId: "model-1",
    createdBy: "user-1",
    baseModel: BASE_MODEL,
    datasetName: "faq.jsonl",
    jsonl: sampleJsonl(),
    hyperparameters: HYPERPARAMETERS,
  });
}

test("H3: Job の ID が無いまま時間切れの学習は、同時に問い合わせても仮押さえを一度だけ戻す", async () => {
  const held = 5_000_000;
  const row: FineTuneRow = {
    ...succeededJob(),
    status: "queued",
    nebiusJobId: null,
    activeKey: "model-1",
    adapterUri: null,
    heldMicros: held,
    startedAt: null,
    completedAt: null,
  };
  const { deps, balances, fineTunes, clock } = setup({ fineTunes: [row] }, {}, BALANCE - held);
  clock.advance(11 * 60_000);
  await Promise.all([refreshFineTune(deps, row), refreshFineTune(deps, row), refreshFineTune(deps, row)]);
  assert.equal(balances.get(ORG), BALANCE);
  assert.equal(fineTunes.get("ft-1")!.status, "failed");
  assert.equal(fineTunes.get("ft-1")!.activeKey, null);
});

test("H3: 止めるのと終わったのを見つけるのが同時でも、精算は一度だけで状態と合う", async () => {
  const { deps, balances, ledger, fineTunes, clock } = setup({}, {
    getFineTune: async () => ({ state: "succeeded" as const, adapterUri: "s3://bucket/adapter" }),
  });
  const result = await start(deps);
  assert.ok(result.ok);
  clock.advance(30 * 60_000);
  const [canceled, refreshed] = await Promise.all([
    cancelFineTune(deps, result.row),
    refreshFineTune(deps, result.row),
  ]);
  assert.equal(ledger.length, 1);
  const cost = computeCostMicros(result.row.trainMicrosPerHour, 30 * 60);
  assert.equal(balances.get(ORG), BALANCE - cost);
  const final = fineTunes.get(result.row.id)!;
  assert.equal(final.heldMicros, 0);
  assert.ok(["canceled", "succeeded"].includes(final.status));
  assert.ok([canceled.status, refreshed.status].includes(final.status));
});

test("M5: Job を始めた後に記録に失敗したら、Job を止めて失敗にし、仮押さえは一度だけ戻す", async () => {
  const { deps, calls, balances, fineTunes, stores } = setup({});
  const update = stores.fineTunes.update;
  let first = true;
  deps.fineTunes.update = async (id, patch, onlyIf) => {
    if (first) {
      first = false;
      throw new Error("db timeout");
    }
    return update(id, patch, onlyIf);
  };
  const result = await start(deps);
  assert.equal(!result.ok && result.reason, "start_failed");
  assert.deepEqual(
    calls.filter((call) => call.name === "cancelFineTune").map((call) => call.args[1]),
    ["job-1"],
  );
  const row = [...fineTunes.values()][0];
  assert.equal(row.status, "failed");
  assert.equal(row.nebiusJobId, "job-1");
  assert.equal(row.heldMicros, 0);
  assert.equal(row.activeKey, null);
  assert.equal(balances.get(ORG), BALANCE);
});

test("L2: 同じモデルで同時に学習を始めても1つだけ。終われば次を始められる", async () => {
  const { deps, calls, balances } = setup({});
  const results = await Promise.all([start(deps), start(deps)]);
  const ok = results.filter((result) => result.ok);
  assert.equal(ok.length, 1);
  assert.ok(results.some((result) => !result.ok && result.reason === "already_running"));
  assert.equal(calls.filter((call) => call.name === "startFineTune").length, 1);
  const first = ok[0].ok ? ok[0].row : null;
  assert.equal(balances.get(ORG), BALANCE - first!.heldMicros);

  await cancelFineTune(deps, first!);
  const next = await start(deps);
  assert.ok(next.ok);
});
