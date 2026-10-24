import { clientLocale, translate } from "@/lib/i18n";
import type { ModelCategory } from "@/lib/billing/pricing";
import type { ModelConfig } from "@/lib/models/config";
import type { DatasetIssue } from "@/lib/models/dataset";
import type { FineTuneHyperparameters } from "@/lib/nebius";
import type { ExtractResult, Fact, ParaphraseResult } from "@/lib/nemotron/dataset-builder";
import type { EvalSummary } from "@/lib/nemotron/evaluation";

/*
 * 画面から呼ぶ API。組織のもの (モデル・学習・残高・キー) は /api/organizations/:id の下にある。
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const data = (await response.json().catch(() => null)) as
    | (T & { message?: string; error?: { message?: string; code?: string } })
    | null;
  if (!response.ok) {
    throw new ApiError(
      data?.message ||
        data?.error?.message ||
        translate(clientLocale(), "common.apiError"),
      response.status,
      data?.error?.code,
      data,
    );
  }
  return data as T;
}

function orgPath(organizationId: string, suffix: string) {
  return `/api/organizations/${encodeURIComponent(organizationId)}${suffix}`;
}

function withQuery(path: string, params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export type Page<T> = { items: T[]; nextCursor: string | null };

// ---------------------------------------------------------------- models

export type ModelStatus = "draft" | "published" | "suspended";
export type ModelVisibility = "public" | "private";
export type EndpointStatus =
  | "none"
  | "deploying"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export type ModelRecord = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: ModelCategory;
  tags: string[];
  /** 実行の設定 (返答の上限など) */
  config: ModelConfig;
  visibility: ModelVisibility;
  status: ModelStatus;
  baseModelId: string | null;
  adapterUri: string | null;
  fineTuneId: string | null;
  endpointId: string | null;
  endpointStatus: EndpointStatus;
  endpointError: string | null;
  endpointLastUsedAt: string | null;
  /** 入力100万トークンあたり (マイクロ円) */
  priceInputMicros: number;
  /** 出力100万トークンあたり (マイクロ円) */
  priceOutputMicros: number;
  /** 1リクエストあたり (マイクロ円) */
  pricePerRequestMicros: number;
  totalRequests: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModelUpdateInput = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: ModelCategory;
  tags: string[];
  config: ModelConfig;
  pricing: {
    priceInputMicros: number;
    priceOutputMicros: number;
    pricePerRequestMicros: number;
  };
};

export function listModels(
  organizationId: string,
  options: { cursor?: string; pageSize?: number } = {},
) {
  return apiRequest<Page<ModelRecord>>(
    withQuery(orgPath(organizationId, "/models"), options),
  );
}

export function createModel(
  organizationId: string,
  input: { name: string },
) {
  return apiRequest<ModelRecord>(orgPath(organizationId, "/models"), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

function modelPath(organizationId: string, modelId: string, suffix = "") {
  return orgPath(organizationId, `/models/${encodeURIComponent(modelId)}${suffix}`);
}

export function getModel(organizationId: string, modelId: string) {
  return apiRequest<ModelRecord>(modelPath(organizationId, modelId));
}

export function updateModel(
  organizationId: string,
  modelId: string,
  input: ModelUpdateInput,
) {
  return apiRequest<ModelRecord>(modelPath(organizationId, modelId), {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function publishModel(
  organizationId: string,
  modelId: string,
  visibility: ModelVisibility,
) {
  return apiRequest<{ ok: true }>(modelPath(organizationId, modelId, "/publish"), {
    method: "POST",
    body: JSON.stringify({ visibility }),
  });
}

export function unpublishModel(organizationId: string, modelId: string) {
  return apiRequest<{ ok: true }>(modelPath(organizationId, modelId, "/unpublish"), {
    method: "POST",
  });
}

export function deleteModel(organizationId: string, modelId: string) {
  return apiRequest<{ ok: true }>(modelPath(organizationId, modelId), {
    method: "DELETE",
  });
}

export type ModelStats = {
  days: Array<{
    day: string;
    requests: number;
    failures: number;
    creatorMicros: number;
    inputTokens: number;
    outputTokens: number;
    avgLatencyMs: number;
  }>;
};

export function getModelStats(organizationId: string, modelId: string) {
  return apiRequest<ModelStats>(modelPath(organizationId, modelId, "/stats"));
}

// ---------------------------------------------------------------- endpoints

export function deployModel(organizationId: string, modelId: string, fineTuneId: string) {
  return apiRequest<ModelRecord>(modelPath(organizationId, modelId, "/deploy"), {
    method: "POST",
    body: JSON.stringify({ fineTuneId }),
  });
}

export function undeployModel(organizationId: string, modelId: string) {
  return apiRequest<{ ok: true }>(modelPath(organizationId, modelId, "/deploy"), {
    method: "DELETE",
  });
}

/** Nebius に状態を問い合わせて、最新のモデルを返す */
export function refreshEndpoint(organizationId: string, modelId: string) {
  return apiRequest<ModelRecord>(modelPath(organizationId, modelId, "/endpoint"));
}

export function startEndpoint(organizationId: string, modelId: string) {
  return apiRequest<ModelRecord>(modelPath(organizationId, modelId, "/endpoint/start"), {
    method: "POST",
  });
}

export function stopEndpoint(organizationId: string, modelId: string) {
  return apiRequest<ModelRecord>(modelPath(organizationId, modelId, "/endpoint/stop"), {
    method: "POST",
  });
}

// ---------------------------------------------------------------- fine-tunes

export type BaseModelOption = {
  id: string;
  label: string;
  trainPreset: string;
  servePreset: string;
  /** 上乗せ込みの1時間あたりの料金 (マイクロ円) */
  trainMicrosPerHour: number;
  serveMicrosPerHour: number;
};

export function listBaseModels(organizationId: string) {
  return apiRequest<{ items: BaseModelOption[]; idleMinutes: number }>(
    orgPath(organizationId, "/base-models"),
  );
}

export type FineTuneStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type FineTuneRecord = {
  id: string;
  modelId: string;
  baseModelId: string;
  datasetName: string;
  datasetBytes: number;
  datasetExamples: number;
  /** upload / builder (Nemotron で作った) */
  datasetSource: "upload" | "builder";
  /** 評価用に取っておいた例の数 */
  evalExamples: number;
  hyperparameters: Partial<FineTuneHyperparameters>;
  status: FineTuneStatus;
  adapterUri: string | null;
  error: string | null;
  estimatedMicros: number;
  heldMicros: number;
  costMicros: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export function isFineTuneActive(job: Pick<FineTuneRecord, "status">) {
  return job.status === "queued" || job.status === "running";
}

export function listFineTunes(organizationId: string, modelId: string) {
  return apiRequest<{ items: FineTuneRecord[] }>(
    modelPath(organizationId, modelId, "/fine-tunes"),
  );
}

export function startFineTune(
  organizationId: string,
  modelId: string,
  input: {
    baseModelId: string;
    datasetName: string;
    jsonl: string;
    hyperparameters: FineTuneHyperparameters;
    evalJsonl?: string | null;
    datasetSource?: "upload" | "builder";
    datasetRole?: string | null;
  },
) {
  return apiRequest<FineTuneRecord>(modelPath(organizationId, modelId, "/fine-tunes"), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 学習の開始を断られたときに返る、学習データの問題 */
export function datasetIssuesOf(error: unknown): DatasetIssue[] {
  if (!(error instanceof ApiError)) return [];
  const issues = (error.data as { issues?: unknown } | undefined)?.issues;
  return Array.isArray(issues) ? (issues as DatasetIssue[]) : [];
}

export function getFineTune(organizationId: string, fineTuneId: string) {
  return apiRequest<FineTuneRecord>(
    orgPath(organizationId, `/fine-tunes/${encodeURIComponent(fineTuneId)}`),
  );
}

export function cancelFineTune(organizationId: string, fineTuneId: string) {
  return apiRequest<FineTuneRecord>(
    orgPath(organizationId, `/fine-tunes/${encodeURIComponent(fineTuneId)}/cancel`),
    { method: "POST" },
  );
}

// ---------------------------------------------------------------- Nemotron (学習データ作り・評価・モデルカード)

type BuilderUsage = { costMicros: number; inputTokens: number; outputTokens: number };

function datasetBuilder<T>(organizationId: string, modelId: string, body: Record<string, unknown>) {
  return apiRequest<T & BuilderUsage>(modelPath(organizationId, modelId, "/dataset-builder"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** 資料の chunk 番目のかたまりから、Nemotron に事実を取り出させる (1回の呼び出し) */
export function extractDatasetFacts(
  organizationId: string,
  modelId: string,
  input: { role: string; material: string; chunk: number },
) {
  return datasetBuilder<ExtractResult & { chunkCount: number }>(organizationId, modelId, {
    stage: "facts",
    ...input,
  });
}

/** 事実 (BUILDER_FACTS_PER_CALL 個まで) を、Nemotron に違う言い方の質問にさせる (1回の呼び出し) */
export function paraphraseDatasetFacts(
  organizationId: string,
  modelId: string,
  input: { role: string; facts: Fact[] },
) {
  return datasetBuilder<ParaphraseResult>(organizationId, modelId, { stage: "paraphrase", ...input });
}

export type EvalRunStatus = "running" | "succeeded" | "failed" | "canceled";

export type EvalRunRecord = {
  id: string;
  fineTuneId: string;
  status: EvalRunStatus;
  baselineModel: string;
  judgeModel: string;
  itemCount: number;
  summary: EvalSummary | null;
  costMicros: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type EvalItemRecord = {
  id: string;
  position: number;
  prompt: ChatMessage[];
  reference: string;
  status: "pending" | "running" | "done" | "failed";
  fineTunedAnswer: string | null;
  baseAnswer: string | null;
  fineTunedScore: number | null;
  baseScore: number | null;
  fineTunedReason: string | null;
  baseReason: string | null;
  error: string | null;
};

export type EvaluationOverview = {
  items: EvalRunRecord[];
  fineTuneId: string | null;
  /** 評価できない理由 (できるなら null) */
  blocker: "not_deployed" | "no_eval_set" | null;
  questions: number;
  /** Token Factory 代の上限の見込み (マイクロ円) */
  estimateMicros: number;
  baselineModel: string;
};

export function listEvaluations(organizationId: string, modelId: string) {
  return apiRequest<EvaluationOverview>(modelPath(organizationId, modelId, "/evaluations"));
}

export function startEvaluation(organizationId: string, modelId: string) {
  return apiRequest<EvalRunRecord>(modelPath(organizationId, modelId, "/evaluations"), {
    method: "POST",
    body: "{}",
  });
}

export function getEvaluation(organizationId: string, runId: string) {
  return apiRequest<EvalRunRecord & { items: EvalItemRecord[] }>(
    orgPath(organizationId, `/evaluations/${encodeURIComponent(runId)}`),
  );
}

export type EvalStepResponse =
  | { state: "running"; remaining: number; run: EvalRunRecord }
  | { state: "done"; run: EvalRunRecord | null }
  | { state: "warming_up"; retryAfter: number; run: EvalRunRecord };

/** 評価を数問ぶん進める。残高が足りなければ 402 (ApiError) */
export function stepEvaluation(organizationId: string, runId: string) {
  return apiRequest<EvalStepResponse>(
    orgPath(organizationId, `/evaluations/${encodeURIComponent(runId)}/step`),
    { method: "POST", body: "{}" },
  );
}

export type ModelCardDraft = {
  tagline: string;
  description: string;
  tags: string[];
  costMicros: number;
};

export function draftModelCard(organizationId: string, modelId: string, locale: "ja" | "en") {
  return apiRequest<ModelCardDraft>(modelPath(organizationId, modelId, "/model-card/draft"), {
    method: "POST",
    body: JSON.stringify({ locale }),
  });
}

// ---------------------------------------------------------------- playground

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * プレイグラウンドでのチャット。生成されたそばから onDelta に渡す (思考は reasoning、本文は content)。
 * 料金は選んでいる組織のクレジットから引き落とされ、ストリーム最後のコメント行 (`: cost_jpy=…`) で届く。
 */
export async function playgroundChatStream(
  organizationId: string,
  input: { model: string; messages: ChatMessage[]; max_tokens?: number },
  onDelta: (delta: { content?: string; reasoning?: string }) => void,
  signal?: AbortSignal,
): Promise<{ costYen: number | null }> {
  const response = await fetch(orgPath(organizationId, "/playground/chat"), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, stream: true }),
    signal,
  });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => null)) as {
      error?: { message?: string; code?: string };
      message?: string;
    } | null;
    throw new ApiError(
      data?.error?.message || data?.message || translate(clientLocale(), "common.apiError"),
      response.status,
      data?.error?.code,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let costYen: number | null = null;
  const handleLine = (line: string) => {
    if (line.startsWith(": cost_jpy=")) {
      const value = Number(line.slice(": cost_jpy=".length));
      if (Number.isFinite(value)) costYen = value;
      return;
    }
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let event: {
      error?: { message?: string };
      choices?: Array<{
        delta?: {
          content?: string | null;
          // vLLM は推論パーサーを使うと思考をここに入れる (版により名前が違う)
          reasoning_content?: string | null;
          reasoning?: string | null;
        };
      }>;
    };
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event.error) {
      throw new ApiError(
        event.error.message || translate(clientLocale(), "common.apiError"),
        502,
      );
    }
    const delta = event.choices?.[0]?.delta;
    const reasoning = delta?.reasoning_content ?? delta?.reasoning ?? undefined;
    const content = delta?.content ?? undefined;
    if (reasoning || content) onDelta({ content, reasoning });
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  buffer += decoder.decode();
  if (buffer) handleLine(buffer);
  return { costYen };
}

// ---------------------------------------------------------------- store (public)

export type StorePricing = {
  priceInputMicros: number;
  priceOutputMicros: number;
  pricePerRequestMicros: number;
};

export type StoreListing = {
  slug: string;
  name: string;
  tagline: string;
  category: ModelCategory;
  tags: string[];
  /** モデルの元になった Nemotron */
  baseModel: string | null;
  publisherName: string;
  totalRequests: number;
  publishedAt: string | null;
  pricing: StorePricing;
};

export type StoreModelDetail = StoreListing & {
  description: string;
  /** 成功した実行で実際に請求した1回あたりの額の平均 (まだ実行が無ければ null) */
  averageCostMicros: number | null;
  /** false なら、最初の呼び出しで起動を待つ */
  warm: boolean;
  /** いま載せている LoRA を Nemotron が評価した結果 (まだなら null) */
  evaluation?: PublicEvaluation | null;
};

export type PublicEvaluation = Pick<
  EvalSummary,
  | "n"
  | "fineTunedMean"
  | "baseMean"
  | "wins"
  | "ties"
  | "losses"
  | "winRate"
  | "signTestP"
  | "interval"
  | "verdict"
> & { baselineModel: string; judgeModel: string; completedAt: string | null };

export type StoreModelPage = {
  items: StoreListing[];
  /** 0 始まりのページ番号 */
  page: number;
  pageSize: number;
  total: number;
  nextPage: number | null;
};

/** page は 0 始まり */
export function listStoreModels(
  options: { q?: string; category?: string; sort?: "popular" | "new"; page?: number } = {},
) {
  return apiRequest<StoreModelPage>(withQuery("/api/store/models", options));
}

export function getStoreModel(slug: string) {
  return apiRequest<StoreModelDetail>(`/api/store/models/${encodeURIComponent(slug)}`);
}

// ---------------------------------------------------------------- api keys

export type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
};

export function listApiKeys(organizationId: string) {
  return apiRequest<{ items: ApiKeyRecord[] }>(orgPath(organizationId, "/api-keys"));
}

/** 返り値の key は発行時の1回しか取得できない。 */
export function createApiKey(organizationId: string, name: string) {
  return apiRequest<ApiKeyRecord & { key: string }>(orgPath(organizationId, "/api-keys"), {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function revokeApiKey(organizationId: string, keyId: string) {
  return apiRequest<{ ok: true }>(
    orgPath(organizationId, `/api-keys/${encodeURIComponent(keyId)}`),
    { method: "DELETE" },
  );
}

// ---------------------------------------------------------------- wallet

export type WalletSummary = {
  creditMicros: number;
  /** 学習とエンドポイントのために仮押さえしている額 (creditMicros からは引いてある) */
  heldMicros: number;
  earningsMicros: number;
  /** 出金できる収益 (保留中の分を除いたもの) */
  availableEarningsMicros: number;
  /** 直近 earningsHoldDays 日の収益。返金・チャージバックに備えて、まだ出金できない */
  pendingEarningsMicros: number;
  earningsHoldDays: number;
  connectAccountId: string | null;
  payoutsEnabled: boolean;
  limits: { topupMinYen: number; topupMaxYen: number; payoutMinYen: number };
};

export function getWallet(organizationId: string) {
  return apiRequest<WalletSummary>(orgPath(organizationId, "/wallet"));
}

export type LedgerKind =
  | "topup"
  | "payout"
  | "adjustment"
  | "refund"
  | "training"
  | "endpoint"
  | "dataset_build"
  | "evaluation"
  | "model_card"
  | "payout_pending"
  | "chargeback";

export type LedgerRecord = {
  id: string;
  kind: LedgerKind;
  balance: "credit" | "earnings";
  amountMicros: number;
  description: string;
  createdAt: string;
};

export function listLedger(
  organizationId: string,
  options: { cursor?: string; pageSize?: number; balance?: "credit" | "earnings" } = {},
) {
  return apiRequest<Page<LedgerRecord>>(
    withQuery(orgPath(organizationId, "/wallet/ledger"), options),
  );
}

/** Stripe Checkout の URL を返す。遷移後 /app/:id/billing?topup=success|cancel に戻る */
export function startTopup(organizationId: string, amountYen: number) {
  return apiRequest<{ url: string }>(orgPath(organizationId, "/wallet/topup"), {
    method: "POST",
    body: JSON.stringify({ amountYen }),
  });
}

export type UsageRecordItem = {
  id: string;
  modelSlug: string;
  source: "api" | "playground";
  status: "succeeded" | "failed";
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  totalMicros: number;
  createdAt: string;
};

export function listUsage(
  organizationId: string,
  options: { cursor?: string; pageSize?: number } = {},
) {
  return apiRequest<Page<UsageRecordItem>>(
    withQuery(orgPath(organizationId, "/usage"), options),
  );
}

export type DailyAmount = { day: string; requests: number; micros: number };

export function getUsageSummary(organizationId: string) {
  return apiRequest<{
    days: DailyAmount[];
    byModel: Array<{ modelSlug: string; requests: number; micros: number }>;
  }>(orgPath(organizationId, "/usage/summary"));
}

export function getEarningsSummary(organizationId: string) {
  return apiRequest<{
    days: DailyAmount[];
    byModel: Array<{
      modelId: string;
      modelSlug: string;
      name: string;
      requests: number;
      micros: number;
    }>;
  }>(orgPath(organizationId, "/earnings/summary"));
}

/** Stripe Connect の登録の URL。戻り先は /app/:id/earnings?connect=return|refresh */
export function startPayoutOnboarding(organizationId: string, country: "JP" | "US" = "JP") {
  return apiRequest<{ url: string }>(orgPath(organizationId, "/payouts/connect"), {
    method: "POST",
    body: JSON.stringify({ country }),
  });
}

export function openPayoutDashboard(organizationId: string) {
  return apiRequest<{ url: string }>(orgPath(organizationId, "/payouts/dashboard"), {
    method: "POST",
  });
}

export function requestPayout(organizationId: string, amountYen: number) {
  // pending: Stripe から応答が無く、送金されたか確認中 (202)
  return apiRequest<
    { ok: true; transferId: string } | { ok: false; pending: true; referenceId: string }
  >(orgPath(organizationId, "/payouts"), {
    method: "POST",
    body: JSON.stringify({ amountYen }),
  });
}
