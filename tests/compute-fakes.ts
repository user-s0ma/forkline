import type {
  ComputeDeps,
  FineTuneRow,
  ModelRow,
  NebiusClient,
} from "../src/lib/compute/types";
import type { HoldSettlement } from "../src/lib/billing/wallet";
import { holdDifference } from "../src/lib/billing/wallet";
import type { NemotronBaseModel } from "../src/lib/nebius";

/*
 * 学習とエンドポイントの流れを DB と Nebius なしで動かすための偽物。
 * src/lib/nebius の関数は呼ばれた順に記録し、返す値はテストごとに差し替える。
 */

export const BASE_MODEL: NemotronBaseModel = {
  id: "nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16",
  label: "Nemotron 3 Nano 4B",
  trainPreset: "gpu-l40s-a/1gpu-16vcpu-64gb",
  servePreset: "gpu-l40s-a/1gpu-8vcpu-32gb",
  trainUsdPerHour: 1.75,
  serveUsdPerHour: 1.55,
  maxContextTokens: 16384,
};

type Call = { name: string; args: unknown[] };

export function fakeNebius(overrides: Partial<NebiusClient> = {}) {
  const calls: Call[] = [];
  const record =
    <T>(name: string, value: T) =>
    async (...args: unknown[]) => {
      calls.push({ name, args });
      return value;
    };
  const nebius: NebiusClient = {
    listNemotronBaseModels: () => [BASE_MODEL],
    uploadTrainingData: record("uploadTrainingData", { datasetUri: "s3://bucket/train.jsonl" }),
    startFineTune: record("startFineTune", { jobId: "job-1" }),
    getFineTune: record("getFineTune", { state: "running" as const }),
    cancelFineTune: record("cancelFineTune", undefined),
    createEndpoint: record("createEndpoint", { endpointId: "ep-1", authToken: "a".repeat(64) }),
    getEndpoint: record("getEndpoint", { state: "starting" as const }),
    startEndpoint: record("startEndpoint", undefined),
    stopEndpoint: record("stopEndpoint", undefined),
    deleteEndpoint: record("deleteEndpoint", undefined),
    checkEndpointReady: record("checkEndpointReady", true),
    proxyChatCompletion: record("proxyChatCompletion", new Response("{}")),
    ...overrides,
  };
  return { nebius, calls };
}

/** 残高と台帳を持つ偽の CreditPort。精算は referenceId で一度だけ */
export function fakeCredits(initial: Record<string, number>) {
  const balances = new Map(Object.entries(initial));
  const ledger: HoldSettlement[] = [];
  const credits: ComputeDeps["credits"] = {
    async reserve(organizationId, micros) {
      const current = balances.get(organizationId) ?? 0;
      if (current < micros) return false;
      balances.set(organizationId, current - micros);
      return true;
    },
    async release(organizationId, micros) {
      balances.set(organizationId, (balances.get(organizationId) ?? 0) + micros);
    },
    async settle(input) {
      if (ledger.some((entry) => entry.kind === input.kind && entry.referenceId === input.referenceId)) {
        return "duplicate";
      }
      ledger.push(input);
      const delta = holdDifference(input.heldMicros, Math.ceil(input.actualMicros));
      balances.set(input.organizationId, (balances.get(input.organizationId) ?? 0) + delta);
      return "applied";
    },
    async balance(organizationId) {
      return balances.get(organizationId) ?? 0;
    },
  };
  return { credits, balances, ledger };
}

export function fakeClock(start = new Date("2026-10-24T00:00:00Z")) {
  let now = start.getTime();
  return {
    now: () => new Date(now),
    advance(ms: number) {
      now += ms;
    },
  };
}

/** DB の代わり。条件付きの更新は本物と同じく、条件に合うときだけ書く */
export function fakeStores(initial: { models?: ModelRow[]; fineTunes?: FineTuneRow[] } = {}) {
  const models = new Map((initial.models ?? []).map((row) => [row.id, { ...row }]));
  const fineTunes = new Map((initial.fineTunes ?? []).map((row) => [row.id, { ...row }]));
  const sameTime = (a: Date | null, b: Date | null) =>
    (a?.getTime() ?? null) === (b?.getTime() ?? null);
  return {
    models,
    fineTunes,
    stores: {
      fineTunes: {
        async insert(row: FineTuneRow) {
          // 本物の activeKey の一意の索引と同じく、走っている学習が同じモデルにあれば重複で失敗する
          if (row.activeKey && [...fineTunes.values()].some((other) => other.activeKey === row.activeKey)) {
            throw new Error("Duplicate entry for key 'FineTune_activeKey_key'");
          }
          fineTunes.set(row.id, { ...row });
        },
        async update(id: string, patch: Partial<FineTuneRow>, onlyIfStatus?: readonly string[]) {
          const row = fineTunes.get(id);
          if (!row) return false;
          if (onlyIfStatus && !onlyIfStatus.includes(row.status)) return false;
          fineTunes.set(id, { ...row, ...patch });
          return true;
        },
      },
      models: {
        async get(id: string) {
          const row = models.get(id);
          return row ? { ...row } : null;
        },
        async update(
          id: string,
          patch: Partial<ModelRow>,
          onlyIf?: {
            endpointStatus?: readonly string[];
            endpointMeteredAt?: Date | null;
            endpointHeldMicros?: number;
          },
        ) {
          const row = models.get(id);
          if (!row) return false;
          if (onlyIf?.endpointStatus && !onlyIf.endpointStatus.includes(row.endpointStatus)) {
            return false;
          }
          if (onlyIf && "endpointMeteredAt" in onlyIf) {
            if (!sameTime(row.endpointMeteredAt, onlyIf.endpointMeteredAt ?? null)) return false;
          }
          if (
            onlyIf?.endpointHeldMicros !== undefined &&
            row.endpointHeldMicros !== onlyIf.endpointHeldMicros
          ) {
            return false;
          }
          models.set(id, { ...row, ...patch });
          return true;
        },
      },
    },
  };
}

export function makeDeps(parts: {
  nebius: NebiusClient;
  credits: ComputeDeps["credits"];
  stores: ReturnType<typeof fakeStores>["stores"];
  now: () => Date;
  idleMinutes?: number;
}): ComputeDeps {
  return {
    env: {
      NEBIUS_PROJECT_ID: "project",
      NEBIUS_REGION: "eu-north1",
      NEBIUS_S3_ENDPOINT: "https://storage.example",
      NEBIUS_S3_BUCKET: "bucket",
      NEBIUS_S3_ACCESS_KEY_ID: "id",
      NEBIUS_S3_SECRET_ACCESS_KEY: "secret",
      NEBIUS_TOKEN_FACTORY_API_KEY: "tf",
      ENDPOINT_IDLE_MINUTES: String(parts.idleMinutes ?? 15),
    },
    nebius: parts.nebius,
    credits: parts.credits,
    fineTunes: parts.stores.fineTunes,
    models: {
      ...parts.stores.models,
      // 本物は1つのトランザクション。精算が失敗したら起点は進めない
      async meter(id, since, now, settlement) {
        const row = await parts.stores.models.get(id);
        if (!row || row.endpointMeteredAt?.getTime() !== since.getTime()) return false;
        await parts.credits.settle(settlement);
        return parts.stores.models.update(
          id,
          { endpointMeteredAt: now },
          { endpointMeteredAt: since },
        );
      },
    },
    tokens: {
      seal: async (value) => `sealed:${value}`,
      open: async (sealed) => sealed.replace(/^sealed:/, ""),
    },
    now: parts.now,
  };
}

export function makeModel(overrides: Partial<ModelRow> = {}): ModelRow {
  const now = new Date("2026-10-24T00:00:00Z");
  return {
    id: "model-1",
    organizationId: "org-pub",
    createdBy: "user-1",
    slug: "support-bot",
    name: "Support bot",
    tagline: "",
    description: "",
    category: "text",
    tags: "[]",
    config: JSON.stringify({ maxOutputTokens: 2048 }),
    visibility: "private",
    status: "draft",
    baseModelId: null,
    adapterUri: null,
    fineTuneId: null,
    endpointId: null,
    endpointStatus: "none",
    endpointUrl: null,
    endpointToken: null,
    endpointMicrosPerHour: 0,
    endpointError: null,
    endpointLastUsedAt: null,
    endpointMeteredAt: null,
    endpointHeldMicros: 0,
    priceInputMicros: 0,
    priceOutputMicros: 0,
    pricePerRequestMicros: 0,
    totalRequests: 0,
    avgCostMicros: null,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** 10件の正しい学習データ */
export function sampleJsonl(count = 10) {
  return Array.from({ length: count }, (_, index) =>
    JSON.stringify({
      messages: [
        { role: "system", content: "You are a support bot." },
        { role: "user", content: `Question ${index}` },
        { role: "assistant", content: `Answer ${index}` },
      ],
    }),
  ).join("\n");
}
