import { z } from "zod";

/*
 * 学習データ (chat 形式の JSONL) の検査。ブラウザで選んだときと、サーバーで受け取ったときの両方で使う。
 * 1行に1つ、{"messages": [{"role": "system" | "user" | "assistant", "content": "..."}]} を書く。
 */

export const DATASET_MAX_BYTES = 10 * 1024 * 1024;
export const DATASET_MIN_EXAMPLES = 10;
export const DATASET_MAX_EXAMPLES = 50_000;
/** エラーはこの数まで集めて止める (大きなファイルで画面が埋まらないように) */
const MAX_REPORTED_ERRORS = 20;

export type DatasetErrorCode =
  | "invalid_json"
  | "not_object"
  | "missing_messages"
  | "invalid_role"
  | "empty_content"
  | "no_assistant"
  | "no_user";

export type DatasetIssue =
  | { code: "too_large"; maxBytes: number }
  | { code: "too_few"; min: number }
  | { code: "too_many"; max: number }
  | { code: DatasetErrorCode; line: number };

export type DatasetCheck = {
  ok: boolean;
  bytes: number;
  examples: number;
  issues: DatasetIssue[];
};

const ROLES = new Set(["system", "user", "assistant"]);

function lineError(record: unknown): DatasetErrorCode | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return "not_object";
  }
  const messages = (record as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return "missing_messages";
  }
  let hasUser = false;
  let hasAssistant = false;
  for (const message of messages) {
    if (!message || typeof message !== "object") return "invalid_role";
    const { role, content } = message as { role?: unknown; content?: unknown };
    if (typeof role !== "string" || !ROLES.has(role)) return "invalid_role";
    if (typeof content !== "string" || !content.trim()) return "empty_content";
    if (role === "user") hasUser = true;
    if (role === "assistant") hasAssistant = true;
  }
  if (!hasUser) return "no_user";
  if (!hasAssistant) return "no_assistant";
  return null;
}

export function byteLength(text: string) {
  return new TextEncoder().encode(text).byteLength;
}

/** JSONL 全体を調べる。空行は読み飛ばす。minExamples は評価用の例を調べるときに下げる */
export function checkDataset(
  jsonl: string,
  options: { minExamples?: number; maxBytes?: number } = {},
): DatasetCheck {
  const minExamples = options.minExamples ?? DATASET_MIN_EXAMPLES;
  const maxBytes = options.maxBytes ?? DATASET_MAX_BYTES;
  const bytes = byteLength(jsonl);
  const issues: DatasetIssue[] = [];
  if (bytes > maxBytes) {
    return {
      ok: false,
      bytes,
      examples: 0,
      issues: [{ code: "too_large", maxBytes }],
    };
  }
  let examples = 0;
  const lines = jsonl.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    examples += 1;
    if (issues.length >= MAX_REPORTED_ERRORS) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      issues.push({ code: "invalid_json", line: index + 1 });
      continue;
    }
    const code = lineError(record);
    if (code) issues.push({ code, line: index + 1 });
  }
  if (examples < minExamples) {
    issues.push({ code: "too_few", min: minExamples });
  }
  if (examples > DATASET_MAX_EXAMPLES) {
    issues.push({ code: "too_many", max: DATASET_MAX_EXAMPLES });
  }
  return { ok: issues.length === 0, bytes, examples, issues };
}

/* ---------------------------------------------------------------- 評価用の例 */

/** 学習に使わずに取っておく評価用の例 (chat 形式の JSONL) の上限 */
export const EVAL_SET_MAX_BYTES = 1024 * 1024;
export const EVAL_SET_MAX_EXAMPLES = 200;

export function checkEvalSet(jsonl: string): DatasetCheck {
  const check = checkDataset(jsonl, { minExamples: 1, maxBytes: EVAL_SET_MAX_BYTES });
  if (check.examples > EVAL_SET_MAX_EXAMPLES) {
    return {
      ...check,
      ok: false,
      issues: [...check.issues, { code: "too_many", max: EVAL_SET_MAX_EXAMPLES }],
    };
  }
  return check;
}

/** JSONL の空でない行を返す (分けるときに使う) */
export function datasetLines(jsonl: string) {
  return jsonl
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/* ---------------------------------------------------------------- 学習データの要約 */

/** モデルカードの下書きに渡す、学習データの要約。中身の全部は渡さない */
export type DatasetSummary = {
  source: "upload" | "builder";
  examples: number;
  /** 作者が書いた役割 (Nemotron で作ったとき) */
  role: string | null;
  /** 学習データの最初の system の発言 */
  systemPrompt: string | null;
  /** 質問の例 (最大 8 件、それぞれ 200 文字まで) */
  sampleQuestions: string[];
};

export function summarizeDataset(
  jsonl: string,
  input: { source: "upload" | "builder"; role?: string | null },
): DatasetSummary {
  const lines = datasetLines(jsonl);
  let systemPrompt: string | null = null;
  const sampleQuestions: string[] = [];
  const step = Math.max(1, Math.floor(lines.length / 8));
  for (let index = 0; index < lines.length && sampleQuestions.length < 8; index += 1) {
    let record: unknown;
    try {
      record = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    const messages = (record as { messages?: Array<{ role?: unknown; content?: unknown }> } | null)
      ?.messages;
    if (!Array.isArray(messages)) continue;
    if (systemPrompt === null) {
      const system = messages.find((m) => m?.role === "system" && typeof m.content === "string");
      if (system) systemPrompt = String(system.content).slice(0, 1000);
    }
    // 全体から散らばるように拾う
    if (index % step !== 0) continue;
    const user = messages.find((m) => m?.role === "user" && typeof m.content === "string");
    if (user) sampleQuestions.push(String(user.content).slice(0, 200));
  }
  return {
    source: input.source,
    examples: lines.length,
    role: input.role ? input.role.slice(0, 1000) : null,
    systemPrompt,
    sampleQuestions,
  };
}

/** 学習のハイパーパラメータ。画面の既定値と、受け付ける範囲 */
export const DEFAULT_HYPERPARAMETERS = {
  epochs: 3,
  learningRate: 0.0002,
  // 事実を覚えさせるには高いランクが効く。alpha はランクの2倍 (peft は alpha/r で縮めるため)
  loraRank: 64,
  loraAlpha: 128,
} as const;

export const hyperparametersSchema = z.object({
  epochs: z.number().int().min(1).max(10),
  learningRate: z.number().min(0.000001).max(0.01),
  loraRank: z.union([
    z.literal(4),
    z.literal(8),
    z.literal(16),
    z.literal(32),
    z.literal(64),
  ]),
  loraAlpha: z.number().int().min(1).max(256),
});

export const LORA_RANKS = [4, 8, 16, 32, 64] as const;
