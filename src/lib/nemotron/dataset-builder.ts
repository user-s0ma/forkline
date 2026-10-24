import { extractJsonObject } from "./json";

/*
 * 学習データ作り。作者が貼った資料を小さなかたまりに分け、かたまりごとに Nemotron に質問と答えを作らせる。
 * 返事は JSON の形と長さを確かめ、合わないものは理由をつけて捨てる。
 * 作った例は画面で作者が直してから、いつもの学習の流れ (JSONL) に渡す。
 * この中の関数はブラウザとサーバーの両方で使う (Nebius は呼ばない)。
 */

export const BUILDER_ROLE_MAX_CHARS = 1_000;
export const BUILDER_MATERIAL_MAX_CHARS = 48_000;
/** 1回に Nemotron に渡す資料の長さ。返事が max_tokens に収まるように小さめにする */
export const BUILDER_CHUNK_CHARS = 4_000;
export const BUILDER_DEFAULT_PER_CHUNK = 8;
export const BUILDER_MAX_PER_CHUNK = 12;
export const BUILDER_MAX_TOKENS = 6_000;
/** 作った例の長さの上限 (これを超えるものは捨てる) */
export const GENERATED_USER_MAX_CHARS = 2_000;
export const GENERATED_ASSISTANT_MAX_CHARS = 6_000;

/** 評価用に取っておく割合と上限 */
/** Token Factory に出させる形 ({"examples":[{"user","assistant"}]}) */
export const EXAMPLES_JSON_SCHEMA = {
  name: "examples",
  schema: {
    type: "object",
    properties: {
      examples: {
        type: "array",
        items: {
          type: "object",
          properties: { user: { type: "string" }, assistant: { type: "string" } },
          required: ["user", "assistant"],
          additionalProperties: false,
        },
      },
    },
    required: ["examples"],
    additionalProperties: false,
  },
};

export const HELD_OUT_RATIO = 0.15;
export const HELD_OUT_MAX = 50;

export type GeneratedExample = { user: string; assistant: string };

export type DroppedReason =
  | "invalid_json"
  | "not_object"
  | "missing_field"
  | "too_long"
  | "duplicate"
  | "too_many";

export type DroppedItem = { index: number; reason: DroppedReason };

/**
 * 資料をかたまりに分ける。段落 (空行) の切れ目を優先し、長すぎる段落は文字数で切る。
 */
export function chunkMaterial(material: string, size = BUILDER_CHUNK_CHARS): string[] {
  const paragraphs = material
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > size) {
      flush();
      for (let start = 0; start < paragraph.length; start += size) {
        chunks.push(paragraph.slice(start, start + size));
      }
      continue;
    }
    if (current && current.length + 2 + paragraph.length > size) flush();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();
  return chunks;
}

/**
 * Nemotron の返事 ({"examples":[{"user","assistant"}]}) を読む。
 * 形が違う・空・長すぎる・重複しているものは捨て、何番目をなぜ捨てたかを返す。
 * seen を渡すと、前のかたまりで作った質問との重複も捨てる。
 */
export function parseGeneratedExamples(
  content: string,
  options: { max?: number; seen?: Set<string> } = {},
): { examples: GeneratedExample[]; dropped: DroppedItem[] } {
  const max = options.max ?? BUILDER_MAX_PER_CHUNK;
  const seen = options.seen ?? new Set<string>();
  const parsed = extractJsonObject(content);
  const list = parsed?.examples;
  if (!Array.isArray(list)) {
    return { examples: [], dropped: [{ index: 0, reason: "invalid_json" }] };
  }
  const examples: GeneratedExample[] = [];
  const dropped: DroppedItem[] = [];
  list.forEach((item: unknown, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      dropped.push({ index, reason: "not_object" });
      return;
    }
    const { user, assistant } = item as { user?: unknown; assistant?: unknown };
    if (typeof user !== "string" || typeof assistant !== "string" || !user.trim() || !assistant.trim()) {
      dropped.push({ index, reason: "missing_field" });
      return;
    }
    const example = { user: user.trim(), assistant: assistant.trim() };
    if (
      example.user.length > GENERATED_USER_MAX_CHARS ||
      example.assistant.length > GENERATED_ASSISTANT_MAX_CHARS
    ) {
      dropped.push({ index, reason: "too_long" });
      return;
    }
    const key = example.user.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) {
      dropped.push({ index, reason: "duplicate" });
      return;
    }
    if (examples.length >= max) {
      dropped.push({ index, reason: "too_many" });
      return;
    }
    seen.add(key);
    examples.push(example);
  });
  return { examples, dropped };
}

/** 学習データの1行 (既存の検査 checkDataset が受け付ける形) */
export function toChatRecord(example: GeneratedExample) {
  return {
    messages: [
      { role: "user", content: example.user },
      { role: "assistant", content: example.assistant },
    ],
  };
}

export function examplesToJsonl(examples: GeneratedExample[]) {
  return examples.map((example) => JSON.stringify(toChatRecord(example))).join("\n");
}

/** 再現できる乱数 (同じ seed なら同じ分け方になる) */
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
 * 評価用に取っておく例の番号を選ぶ。学習には最低 minTrain 件を残す。
 * 件数が少なすぎて残せなければ空 (評価はできない)。
 */
export function pickHeldOut(
  count: number,
  options: { ratio?: number; seed?: number; minTrain?: number; max?: number } = {},
): Set<number> {
  const ratio = options.ratio ?? HELD_OUT_RATIO;
  const minTrain = options.minTrain ?? 10;
  const max = options.max ?? HELD_OUT_MAX;
  const wanted = Math.min(max, Math.max(1, Math.round(count * ratio)), count - minTrain);
  if (wanted <= 0) return new Set();
  const order = Array.from({ length: count }, (_, index) => index);
  const random = mulberry32(options.seed ?? 1);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return new Set(order.slice(0, wanted));
}

/** 学習用と評価用に分ける (並び順は元のまま) */
export function splitHeldOut<T>(
  items: T[],
  options: Parameters<typeof pickHeldOut>[1] = {},
): { train: T[]; heldOut: T[] } {
  const picked = pickHeldOut(items.length, options);
  return {
    train: items.filter((_, index) => !picked.has(index)),
    heldOut: items.filter((_, index) => picked.has(index)),
  };
}
