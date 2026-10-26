import type { FineTuneHyperparameters, NemotronBaseModel } from "../nebius";
import {
  computeCostMicros,
  estimateTrainingMicros,
  TRAIN_MAX_SECONDS,
  trainingHoldMicros,
} from "../billing/compute";
import { isDuplicateKeyError } from "../billing/wallet";
import {
  checkDataset,
  checkEvalSet,
  summarizeDataset,
  type DatasetIssue,
} from "../models/dataset";
import {
  errorText,
  ratesFor,
  type ComputeDeps,
  type FineTuneRow,
} from "./types";

/*
 * LoRA の学習の流れ。
 *   始める: 見積もりの 1.5 倍を仮押さえ → 学習データを置く → Job を始める (queued)
 *   見回る: Nebius の状態を読み、running / succeeded / failed に進める
 *   終わる: 始めてから終わったのを見つけるまでの時間 × GPU の単価で精算し、仮押さえとの差を戻す
 * 終わらせるときは、まず条件付きの更新で終わった状態 (仮押さえ 0) にし、更新できたときだけ精算する
 * (見回りと画面からの問い合わせが同時に走っても、仮押さえを二度戻さない)。
 * 金額の計算は src/lib/billing/compute.ts にまとめてある。
 */

export const ACTIVE_FINE_TUNE_STATUSES = ["queued", "running"] as const;
export type FineTuneState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

/** Job の ID を受け取れないまま、この時間が過ぎた学習は失敗にする (途中で落ちた依頼を残さないため) */
const START_TIMEOUT_MS = 10 * 60 * 1000;

export const FINE_TUNE_ERRORS = {
  didNotStart: "Fine-tune did not start",
  timedOut: "Fine-tune exceeded the maximum duration and was stopped",
} as const;

export function isActiveFineTune(status: string) {
  return (ACTIVE_FINE_TUNE_STATUSES as readonly string[]).includes(status);
}

export type StartFineTuneInput = {
  userId: string;
  modelId: string;
  baseModel: NemotronBaseModel;
  datasetName: string;
  jsonl: string;
  hyperparameters: FineTuneHyperparameters;
  /** 学習に使わずに取っておく評価用の例 (JSONL)。評価の画面でここから問題を作る */
  evalJsonl?: string | null;
  /** upload / builder (Nemotron で作った) */
  datasetSource?: "upload" | "builder";
  /** builder で作ったときの、作者が書いた役割 */
  datasetRole?: string | null;
};

export type StartFineTuneResult =
  | { ok: true; row: FineTuneRow }
  | { ok: false; reason: "invalid_dataset"; issues: DatasetIssue[] }
  | { ok: false; reason: "invalid_eval_set"; issues: DatasetIssue[] }
  | { ok: false; reason: "insufficient_credits"; holdMicros: number }
  | { ok: false; reason: "already_running" }
  | { ok: false; reason: "start_failed"; row: FineTuneRow };

/** 学習を始める前の見積もり (画面で見せる額と、仮押さえする額) */
export function quoteFineTune(input: {
  trainMicrosPerHour: number;
  datasetBytes: number;
  epochs: number;
}) {
  const estimatedMicros = estimateTrainingMicros(input);
  return { estimatedMicros, holdMicros: trainingHoldMicros(estimatedMicros) };
}

/** 学習データを置く場所。利用者と学習ごとに分ける */
export function datasetKey(userId: string, fineTuneId: string) {
  return `users/${userId}/fine-tunes/${fineTuneId}/train.jsonl`;
}

export function adapterPrefix(userId: string, fineTuneId: string) {
  return `users/${userId}/fine-tunes/${fineTuneId}/adapter/`;
}

export async function startFineTune(
  deps: ComputeDeps,
  input: StartFineTuneInput,
): Promise<StartFineTuneResult> {
  const check = checkDataset(input.jsonl);
  if (!check.ok) {
    return { ok: false, reason: "invalid_dataset", issues: check.issues };
  }
  const evalJsonl = input.evalJsonl?.trim() || null;
  const evalCheck = evalJsonl ? checkEvalSet(evalJsonl) : null;
  if (evalCheck && !evalCheck.ok) {
    return { ok: false, reason: "invalid_eval_set", issues: evalCheck.issues };
  }
  const datasetSource = input.datasetSource ?? "upload";
  const { trainMicrosPerHour } = ratesFor(input.baseModel);
  const { estimatedMicros, holdMicros } = quoteFineTune({
    trainMicrosPerHour,
    datasetBytes: check.bytes,
    epochs: input.hyperparameters.epochs,
  });
  if (!(await deps.credits.reserve(input.userId, holdMicros))) {
    return { ok: false, reason: "insufficient_credits", holdMicros };
  }

  const now = deps.now();
  const row: FineTuneRow = {
    id: crypto.randomUUID(),
    userId: input.userId,
    modelId: input.modelId,
    baseModelId: input.baseModel.id,
    trainPreset: input.baseModel.trainPreset,
    trainMicrosPerHour,
    datasetName: input.datasetName.slice(0, 255),
    datasetUri: null,
    datasetBytes: check.bytes,
    datasetExamples: check.examples,
    datasetSource,
    datasetSummary: JSON.stringify(
      summarizeDataset(input.jsonl, { source: datasetSource, role: input.datasetRole }),
    ),
    evalSet: evalJsonl,
    evalExamples: evalCheck?.examples ?? 0,
    hyperparameters: JSON.stringify(input.hyperparameters),
    nebiusJobId: null,
    activeKey: input.modelId,
    status: "queued",
    adapterUri: null,
    error: null,
    estimatedMicros,
    heldMicros: holdMicros,
    costMicros: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
  };
  try {
    await deps.fineTunes.insert(row);
  } catch (error) {
    await deps.credits.release(input.userId, holdMicros);
    // 同じモデルの学習がもう走っている (activeKey の一意の索引)
    if (isDuplicateKeyError(error)) return { ok: false, reason: "already_running" };
    throw error;
  }

  let jobId: string | null = null;
  try {
    const { datasetUri } = await deps.nebius.uploadTrainingData(deps.env, {
      key: datasetKey(input.userId, row.id),
      jsonl: input.jsonl,
    });
    row.datasetUri = datasetUri;
    const started = await deps.nebius.startFineTune(deps.env, {
      baseModelId: input.baseModel.id,
      datasetUri,
      outputPrefix: adapterPrefix(input.userId, row.id),
      hyperparameters: input.hyperparameters,
    });
    jobId = started.jobId;
    const startedAt = deps.now();
    Object.assign(row, { nebiusJobId: jobId, startedAt, updatedAt: startedAt });
    await deps.fineTunes.update(
      row.id,
      { datasetUri, nebiusJobId: jobId, startedAt },
      ACTIVE_FINE_TUNE_STATUSES,
    );
    return { ok: true, row };
  } catch (error) {
    console.error("学習を始められませんでした:", row.id, error);
    // Job が始まってから記録に失敗したときは、Job を止める (記録の無いまま GPU が動き続けないように)
    if (jobId) {
      const started = jobId;
      await deps.nebius
        .cancelFineTune(deps.env, started)
        .catch((cancelError) => console.error("始めた Job を止められませんでした:", started, cancelError));
    }
    const completedAt = deps.now();
    const costMicros = jobId ? trainingCostMicros(row, completedAt) : 0;
    const patch: Partial<FineTuneRow> = {
      status: "failed",
      error: errorText(error),
      nebiusJobId: jobId,
      heldMicros: 0,
      costMicros,
      completedAt,
      activeKey: null,
    };
    let updated = false;
    try {
      updated = await deps.fineTunes.update(row.id, patch, ACTIVE_FINE_TUNE_STATUSES);
    } catch (updateError) {
      // 記録できなければ、見回りが「始まらなかった学習」として失敗にし、そこで仮押さえを戻す
      console.error("学習の失敗を記録できませんでした:", row.id, updateError);
    }
    if (updated) {
      if (jobId) {
        // 少しでも動いた分は精算する (Job の ID で一度だけ)
        await deps.credits.settle({
          userId: input.userId,
          kind: "training",
          referenceId: row.id,
          heldMicros: holdMicros,
          actualMicros: costMicros,
          description: `Fine-tune ${input.baseModel.id} (failed to record)`,
        });
      } else {
        await deps.credits.release(input.userId, holdMicros);
      }
    }
    Object.assign(row, patch, { updatedAt: completedAt });
    return { ok: false, reason: "start_failed", row };
  }
}

/** 学習に使った秒数。始めた時刻から終わったのを見つけた時刻まで */
export function trainingSeconds(row: Pick<FineTuneRow, "startedAt">, endedAt: Date) {
  if (!row.startedAt) return 0;
  return Math.max(0, (endedAt.getTime() - row.startedAt.getTime()) / 1000);
}

/** 実際の学習の料金 */
export function trainingCostMicros(
  row: Pick<FineTuneRow, "startedAt" | "trainMicrosPerHour">,
  endedAt: Date,
) {
  return computeCostMicros(row.trainMicrosPerHour, trainingSeconds(row, endedAt));
}

/**
 * 学習を終わった状態にして精算する。精算は学習の ID で一度だけ行われるので、
 * 同時に見回りが走っても二重には引かない。
 */
async function finish(
  deps: ComputeDeps,
  row: FineTuneRow,
  outcome:
    | { status: "succeeded"; adapterUri: string }
    | { status: "failed"; error: string }
    | { status: "canceled" },
): Promise<FineTuneRow> {
  const completedAt = deps.now();
  const costMicros = trainingCostMicros(row, completedAt);
  const patch: Partial<FineTuneRow> = {
    status: outcome.status,
    adapterUri: outcome.status === "succeeded" ? outcome.adapterUri : row.adapterUri,
    error: outcome.status === "failed" ? outcome.error.slice(0, 500) : row.error,
    completedAt,
    costMicros,
    heldMicros: 0,
    activeKey: null,
  };
  // 先に終わった状態を決める。ほかが先に終わらせていたら、精算もそちらに任せる
  const updated = await deps.fineTunes.update(row.id, patch, ACTIVE_FINE_TUNE_STATUSES);
  if (!updated) return row;
  const settlement = {
    userId: row.userId,
    kind: "training" as const,
    referenceId: row.id,
    heldMicros: row.heldMicros,
    actualMicros: costMicros,
    description: `Fine-tune ${row.baseModelId} (${Math.round(trainingSeconds(row, completedAt))}s)`,
  };
  // 精算は学習の ID で一度だけなので、失敗したらもう一度だけ試す
  await deps.credits
    .settle(settlement)
    .catch(() => deps.credits.settle(settlement))
    .catch((error) => console.error("学習の料金を精算できませんでした:", row.id, error));
  return { ...row, ...patch, updatedAt: completedAt };
}

/** Nebius に状態を問い合わせ、進んでいれば記録する (見回りと、画面からの問い合わせで使う) */
export async function refreshFineTune(
  deps: ComputeDeps,
  row: FineTuneRow,
): Promise<FineTuneRow> {
  if (!isActiveFineTune(row.status)) return row;
  const now = deps.now();
  if (!row.nebiusJobId) {
    if (now.getTime() - row.createdAt.getTime() < START_TIMEOUT_MS) return row;
    const patch = {
      status: "failed",
      error: FINE_TUNE_ERRORS.didNotStart,
      heldMicros: 0,
      completedAt: now,
      activeKey: null,
    };
    // 失敗にできたときだけ仮押さえを戻す (同時に問い合わせが来ても一度だけ)
    const updated = await deps.fineTunes.update(row.id, patch, ACTIVE_FINE_TUNE_STATUSES);
    if (!updated) return row;
    await deps.credits.release(row.userId, row.heldMicros);
    return { ...row, ...patch };
  }

  let status;
  try {
    status = await deps.nebius.getFineTune(deps.env, row.nebiusJobId);
  } catch (error) {
    console.error("学習の状態を読めませんでした:", row.id, error);
    return row;
  }

  switch (status.state) {
    case "succeeded":
      return finish(deps, row, { status: "succeeded", adapterUri: status.adapterUri });
    case "failed":
      return finish(deps, row, { status: "failed", error: status.error });
    case "queued":
    case "running": {
      if (trainingSeconds(row, now) > TRAIN_MAX_SECONDS) {
        await deps.nebius.cancelFineTune(deps.env, row.nebiusJobId).catch((error) =>
          console.error("長すぎる学習を止められませんでした:", row.id, error),
        );
        return finish(deps, row, { status: "failed", error: FINE_TUNE_ERRORS.timedOut });
      }
      if (status.state === row.status) return row;
      const updated = await deps.fineTunes.update(
        row.id,
        { status: status.state },
        ACTIVE_FINE_TUNE_STATUSES,
      );
      return updated ? { ...row, status: status.state } : row;
    }
  }
}

/** 学習を止める。そこまでに使った GPU の分は精算する */
export async function cancelFineTune(
  deps: ComputeDeps,
  row: FineTuneRow,
): Promise<FineTuneRow> {
  if (!isActiveFineTune(row.status)) return row;
  if (row.nebiusJobId) {
    await deps.nebius.cancelFineTune(deps.env, row.nebiusJobId);
  }
  return finish(deps, row, { status: "canceled" });
}
