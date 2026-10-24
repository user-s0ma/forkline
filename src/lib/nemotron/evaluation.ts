import type { ChatMessage } from "../nebius";
import { extractJsonObject, oneLine } from "./json";

/*
 * 評価の採点の読み取りと集計。Nebius は呼ばない (呼ぶのは run-evaluation.ts)。
 *
 * 1問ごとに、微調整したモデルとベースの Nemotron の答えを Nemotron が 1〜5 で採点する。
 * 集計では平均点・勝率に加えて、対応のある符号検定の p 値と、平均点の差のブートストラップ信頼区間を出す。
 * 問題数が少ないときは「結論できない」とはっきり返す。
 */

/** 評価に使う問題数の上限 (1回の評価の時間と Token Factory 代を抑える) */
export const EVAL_MAX_ITEMS = 50;
/** これより少ない問題数では、良くなった・悪くなったとは言わない */
export const MIN_ITEMS_FOR_VERDICT = 10;
/** 符号検定で差ありとみなす水準 */
export const SIGNIFICANCE_LEVEL = 0.05;
export const JUDGE_REASON_MAX_CHARS = 200;

export type EvalPrompt = { prompt: ChatMessage[]; reference: string };

/**
 * 評価用の JSONL から問題を作る。最後の assistant の発言を基準の答えにし、その前までを質問にする。
 * 形が合わない行は飛ばす。
 */
export function evalPromptsFromJsonl(jsonl: string, max = EVAL_MAX_ITEMS): EvalPrompt[] {
  const out: EvalPrompt[] = [];
  for (const line of jsonl.split(/\r?\n/)) {
    if (out.length >= max) break;
    const text = line.trim();
    if (!text) continue;
    let record: unknown;
    try {
      record = JSON.parse(text);
    } catch {
      continue;
    }
    const messages = (record as { messages?: unknown } | null)?.messages;
    if (!Array.isArray(messages)) continue;
    const valid = messages.filter(
      (message): message is ChatMessage =>
        Boolean(message) &&
        ["system", "user", "assistant"].includes((message as ChatMessage).role) &&
        typeof (message as ChatMessage).content === "string",
    );
    if (valid.length !== messages.length) continue;
    let last = -1;
    for (let index = valid.length - 1; index >= 0; index -= 1) {
      if (valid[index].role === "assistant") {
        last = index;
        break;
      }
    }
    const prompt = valid.slice(0, last).map((m) => ({ role: m.role, content: m.content }));
    if (last < 0 || !prompt.some((message) => message.role === "user")) continue;
    out.push({ prompt, reference: valid[last].content });
  }
  return out;
}

export type JudgeScore = { score: number; reason: string };

const JUDGE_SCORE_SCHEMA = {
  type: "object",
  properties: { score: { type: "integer", minimum: 1, maximum: 5 }, reason: { type: "string" } },
  required: ["score", "reason"],
  additionalProperties: false,
};

/** Token Factory に出させる形 ({"a":{score,reason},"b":{score,reason}}) */
export const JUDGE_JSON_SCHEMA = {
  name: "judge",
  schema: {
    type: "object",
    properties: { a: JUDGE_SCORE_SCHEMA, b: JUDGE_SCORE_SCHEMA },
    required: ["a", "b"],
    additionalProperties: false,
  },
};
export type JudgeResult = { a: JudgeScore; b: JudgeScore };

function readScore(value: unknown): JudgeScore | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { score, reason } = value as { score?: unknown; reason?: unknown };
  // 点は 1〜5 の整数だけを受け付ける ("4" や 4.5 は採点の取り違えとして捨てる)
  if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) return null;
  if (typeof reason !== "string") return null;
  return { score, reason: oneLine(reason, JUDGE_REASON_MAX_CHARS) };
}

/** 採点役の返事 ({"a":{score,reason},"b":{score,reason}}) を読む。形が違えば null */
export function parseJudgeOutput(content: string): JudgeResult | null {
  const parsed = extractJsonObject(content);
  if (!parsed) return null;
  const a = readScore(parsed.a);
  const b = readScore(parsed.b);
  return a && b ? { a, b } : null;
}

/** A/B の採点を、微調整したモデルとベースの点に戻す */
export function assignScores(result: JudgeResult, fineTunedFirst: boolean) {
  return fineTunedFirst
    ? { fineTuned: result.a, base: result.b }
    : { fineTuned: result.b, base: result.a };
}

/** 問ごとに A/B の並びを入れ替える (どちらを先に置いても偏らないように半々にする) */
export function fineTunedFirstFor(position: number, seed: string) {
  let hash = 2166136261;
  for (const char of `${seed}:${position}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2 === 0;
}

/* ---------------------------------------------------------------- 集計 */

/** 二項分布 B(n, 1/2) で k 以下になる確率 */
function binomialLowerTail(n: number, k: number) {
  if (k < 0) return 0;
  let logCoefficient = 0;
  let sum = 0;
  const logHalfPow = n * Math.log(0.5);
  for (let i = 0; i <= k; i += 1) {
    if (i > 0) logCoefficient += Math.log(n - i + 1) - Math.log(i);
    sum += Math.exp(logCoefficient + logHalfPow);
  }
  return sum;
}

/**
 * 対応のある符号検定 (両側)。引き分けは除く。
 * 勝ちと負けの数が偶然この程度ずれる確率。勝ち負けが無ければ 1
 */
export function signTestPValue(wins: number, losses: number) {
  const n = wins + losses;
  if (n === 0) return 1;
  return Math.min(1, 2 * binomialLowerTail(n, Math.min(wins, losses)));
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 点の差 (微調整 − ベース) の平均の、ブートストラップによる信頼区間 (パーセンタイル法)。
 * 乱数の seed を固定するので、同じ結果からは同じ区間が出る。2問未満なら null
 */
export function bootstrapMeanDiffInterval(
  diffs: number[],
  options: { resamples?: number; level?: number; seed?: number } = {},
): [number, number] | null {
  if (diffs.length < 2) return null;
  const resamples = options.resamples ?? 2000;
  const level = options.level ?? 0.95;
  const random = mulberry32(options.seed ?? 7);
  const means: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    let sum = 0;
    for (let i = 0; i < diffs.length; i += 1) {
      sum += diffs[Math.floor(random() * diffs.length)];
    }
    means.push(sum / diffs.length);
  }
  means.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  const at = (q: number) => means[Math.min(means.length - 1, Math.max(0, Math.floor(q * means.length)))];
  return [round(at(tail)), round(at(1 - tail))];
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export type EvalVerdict = "better" | "worse" | "inconclusive" | "too_few";

export type EvalSummary = {
  /** 採点できた問題数 (集計に使った数) */
  n: number;
  /** 答えか採点が得られず、集計から外した問題数 */
  failed: number;
  fineTunedMean: number;
  baseMean: number;
  /** 微調整 − ベースの平均 */
  meanDiff: number;
  wins: number;
  ties: number;
  losses: number;
  /** 引き分けを半分の勝ちとして数えた勝率 (0〜1) */
  winRate: number;
  /** 対応のある符号検定 (両側) の p 値 */
  signTestP: number;
  /** meanDiff の 95% ブートストラップ信頼区間。2問未満なら null */
  interval: [number, number] | null;
  verdict: EvalVerdict;
};

/**
 * 問ごとの点 (微調整とベース) をまとめる。
 * 判定は符号検定で行い、問題数が MIN_ITEMS_FOR_VERDICT 未満なら結論しない。
 */
export function summarizeEvaluation(
  pairs: Array<{ fineTuned: number; base: number }>,
  failed = 0,
): EvalSummary {
  const n = pairs.length;
  let wins = 0;
  let ties = 0;
  let losses = 0;
  let fineTunedSum = 0;
  let baseSum = 0;
  const diffs: number[] = [];
  for (const pair of pairs) {
    fineTunedSum += pair.fineTuned;
    baseSum += pair.base;
    diffs.push(pair.fineTuned - pair.base);
    if (pair.fineTuned > pair.base) wins += 1;
    else if (pair.fineTuned < pair.base) losses += 1;
    else ties += 1;
  }
  const signTestP = round(signTestPValue(wins, losses), 4);
  let verdict: EvalVerdict = "inconclusive";
  if (n < MIN_ITEMS_FOR_VERDICT) verdict = "too_few";
  else if (signTestP < SIGNIFICANCE_LEVEL) verdict = wins > losses ? "better" : "worse";
  return {
    n,
    failed,
    fineTunedMean: n ? round(fineTunedSum / n, 2) : 0,
    baseMean: n ? round(baseSum / n, 2) : 0,
    meanDiff: n ? round((fineTunedSum - baseSum) / n, 2) : 0,
    wins,
    ties,
    losses,
    winRate: n ? round((wins + ties / 2) / n, 3) : 0,
    signTestP,
    interval: bootstrapMeanDiffInterval(diffs),
    verdict,
  };
}

/** DB に置いた要約を読む。形が違えば null */
export function readSummary(text: string | null): EvalSummary | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as EvalSummary;
    return typeof value?.n === "number" && typeof value.verdict === "string" ? value : null;
  } catch {
    return null;
  }
}
