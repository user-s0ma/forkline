import type { ChatMessage } from "../nebius";
import type { evalItem, evalRun } from "../db/schema";
import { errorText } from "../compute/types";
import { chargedNemotronChat, InsufficientCreditsError, type NemotronDeps } from "./charge";
import {
  assignScores,
  parseJudgeOutput,
  readSummary,
  summarizeEvaluation,
  type EvalSummary,
} from "./evaluation";
import { stripThinking } from "./json";
import { judgeMessages } from "./prompts";

/*
 * 評価を少しずつ進める。1回の呼び出し (step) で数問だけ解かせて採点し、残りは次の step に回す
 * (Workers の1リクエストの外部呼び出しの数と時間に収めるため。画面が step を繰り返し呼ぶ)。
 *   1. 微調整したモデル: 既存の呼び出しの経路 (gateway の runChat) で答えさせる。利用ログが残り、GPU 代は時間で請求される
 *   2. ベース: Token Factory の Nemotron に同じ質問を解かせる (トークン代を組織に請求)
 *   3. 採点: Token Factory の Nemotron が基準の答えと比べて両方を 1〜5 で採点する (トークン代を組織に請求)
 * 全問終わったら集計して、評価を終わった状態にする。
 */

export type EvalRunRow = typeof evalRun.$inferSelect;
export type EvalItemRow = typeof evalItem.$inferSelect;

/** 1回の step で同時に進める問題数 */
export const EVAL_STEP_ITEMS = 3;
/** 答えの長さの上限 (微調整したモデルとベースで揃える) */
export const EVAL_ANSWER_MAX_TOKENS = 1_024;
/** 採点役の返事の上限 (思考が混ざっても JSON まで届くよう多めにする) */
export const JUDGE_MAX_TOKENS = 2_048;
/** 取りかかったまま、この時間が過ぎた問題はもう一度やり直す (途中で切れた step のため) */
export const EVAL_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
const ANSWER_MAX_CHARS = 8_000;

export type EvalStore = {
  /** pending の問題 (と、止まったまま古くなった running) を limit 件まで自分のものにする。attempts を1増やす */
  claim(runId: string, limit: number, now: Date): Promise<EvalItemRow[]>;
  save(id: string, patch: Partial<EvalItemRow>): Promise<void>;
  /** まだ終わっていない (pending / running) 問題の数 */
  remaining(runId: string): Promise<number>;
  /** 終わった (done / failed) 問題 */
  finished(runId: string): Promise<EvalItemRow[]>;
  addCost(runId: string, micros: number): Promise<void>;
  /** running のときだけ評価を更新する。更新できたら true */
  finishRun(runId: string, patch: Partial<EvalRunRow>): Promise<boolean>;
};

export type FineTunedAnswer =
  | { ok: true; content: string }
  | { ok: false; reason: "warming_up"; retryAfter: number }
  | { ok: false; reason: "insufficient_credits" }
  | { ok: false; reason: "error"; message: string };

export type EvalDeps = {
  nemotron: NemotronDeps;
  store: EvalStore;
  /** 微調整したモデルに答えさせる (本番は gateway の runChat を通す) */
  answerFineTuned: (prompt: ChatMessage[]) => Promise<FineTunedAnswer>;
  now: () => Date;
};

export type StepResult =
  | { state: "running"; remaining: number }
  | { state: "done"; summary: EvalSummary | null }
  | { state: "warming_up"; retryAfter: number }
  | { state: "insufficient_credits" };

type ItemOutcome =
  | { kind: "done" | "failed"; costMicros: number }
  | { kind: "retry"; reason: "warming_up"; retryAfter: number; costMicros: number }
  | { kind: "retry"; reason: "insufficient_credits"; costMicros: number };

function readPrompt(text: string): ChatMessage[] | null {
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? (value as ChatMessage[]) : null;
  } catch {
    return null;
  }
}

function clip(text: string) {
  return text.length > ANSWER_MAX_CHARS ? text.slice(0, ANSWER_MAX_CHARS) : text;
}

async function evaluateItem(
  deps: EvalDeps,
  run: EvalRunRow,
  item: EvalItemRow,
): Promise<ItemOutcome> {
  const back = () => deps.store.save(item.id, { status: "pending", claimedAt: null });
  const prompt = readPrompt(item.prompt);
  if (!prompt) {
    await deps.store.save(item.id, { status: "failed", error: "invalid_prompt" });
    return { kind: "failed", costMicros: 0 };
  }

  const fineTuned = await deps.answerFineTuned(prompt);
  if (!fineTuned.ok) {
    if (fineTuned.reason === "warming_up") {
      await back();
      return { kind: "retry", reason: "warming_up", retryAfter: fineTuned.retryAfter, costMicros: 0 };
    }
    if (fineTuned.reason === "insufficient_credits") {
      await back();
      return { kind: "retry", reason: "insufficient_credits", costMicros: 0 };
    }
    await deps.store.save(item.id, { status: "failed", error: fineTuned.message.slice(0, 500) });
    return { kind: "failed", costMicros: 0 };
  }

  let costMicros = 0;
  const label = `Evaluation ${run.id.slice(0, 8)} #${item.position + 1}`;
  const reference = `${item.id}:${item.attempts}`;
  try {
    const base = await chargedNemotronChat(deps.nemotron, {
      organizationId: run.organizationId,
      kind: "evaluation",
      referenceId: `${reference}:base`,
      description: `${label} baseline`,
      messages: prompt,
      maxTokens: EVAL_ANSWER_MAX_TOKENS,
    });
    costMicros += base.costMicros;
    const fineTunedAnswer = clip(stripThinking(fineTuned.content));
    const baseAnswer = clip(stripThinking(base.content));
    const [answerA, answerB] = item.fineTunedFirst
      ? [fineTunedAnswer, baseAnswer]
      : [baseAnswer, fineTunedAnswer];
    const judge = await chargedNemotronChat(deps.nemotron, {
      organizationId: run.organizationId,
      kind: "evaluation",
      referenceId: `${reference}:judge`,
      description: `${label} judge`,
      messages: judgeMessages({ prompt, reference: item.reference, answerA, answerB }),
      maxTokens: JUDGE_MAX_TOKENS,
    });
    costMicros += judge.costMicros;
    const parsed = parseJudgeOutput(judge.content);
    if (!parsed) {
      await deps.store.save(item.id, {
        status: "failed",
        fineTunedAnswer,
        baseAnswer,
        error: "judge_output_invalid",
      });
      return { kind: "failed", costMicros };
    }
    const scores = assignScores(parsed, item.fineTunedFirst);
    await deps.store.save(item.id, {
      status: "done",
      fineTunedAnswer,
      baseAnswer,
      fineTunedScore: scores.fineTuned.score,
      baseScore: scores.base.score,
      fineTunedReason: scores.fineTuned.reason.slice(0, 300),
      baseReason: scores.base.reason.slice(0, 300),
      error: null,
    });
    return { kind: "done", costMicros };
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      await back();
      return { kind: "retry", reason: "insufficient_credits", costMicros };
    }
    console.error("評価の問題を進められませんでした:", item.id, error);
    await deps.store.save(item.id, { status: "failed", error: errorText(error) });
    return { kind: "failed", costMicros };
  }
}

/** 終わった問題から要約を作る */
export function summarizeItems(items: EvalItemRow[]) {
  const pairs: Array<{ fineTuned: number; base: number }> = [];
  let failed = 0;
  for (const item of items) {
    if (item.status === "done" && item.fineTunedScore !== null && item.baseScore !== null) {
      pairs.push({ fineTuned: item.fineTunedScore, base: item.baseScore });
    } else {
      failed += 1;
    }
  }
  return summarizeEvaluation(pairs, failed);
}

export async function stepEvaluation(
  deps: EvalDeps,
  run: EvalRunRow,
  limit = EVAL_STEP_ITEMS,
): Promise<StepResult> {
  if (run.status !== "running") return { state: "done", summary: readSummary(run.summary) };

  const items = await deps.store.claim(run.id, limit, deps.now());
  const outcomes = await Promise.all(items.map((item) => evaluateItem(deps, run, item)));
  const spent = outcomes.reduce((sum, outcome) => sum + outcome.costMicros, 0);
  if (spent > 0) await deps.store.addCost(run.id, spent);

  const warming = outcomes.find(
    (outcome): outcome is Extract<ItemOutcome, { reason: "warming_up" }> =>
      outcome.kind === "retry" && outcome.reason === "warming_up",
  );
  if (warming) return { state: "warming_up", retryAfter: warming.retryAfter };
  if (outcomes.some((outcome) => outcome.kind === "retry")) {
    return { state: "insufficient_credits" };
  }

  const remaining = await deps.store.remaining(run.id);
  if (remaining > 0) return { state: "running", remaining };

  const summary = summarizeItems(await deps.store.finished(run.id));
  const now = deps.now();
  await deps.store.finishRun(run.id, {
    status: summary.n > 0 ? "succeeded" : "failed",
    summary: JSON.stringify(summary),
    error: summary.n > 0 ? null : "No question could be graded",
    completedAt: now,
  });
  return { state: "done", summary };
}
