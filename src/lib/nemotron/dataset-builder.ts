import { extractJsonObject } from "./json";

/*
 * 学習データ作り。作者が貼った資料から、Nemotron に2段階で例を作らせる。
 *   1. 事実を取り出す: かたまりごとに1回。事実ごとに質問と答えを1つずつ。取り違えやすい事実を比べる・まとめる項目と、
 *      資料で答えられない質問も作らせる
 *   2. 言い換える: 事実を BUILDER_FACTS_PER_CALL 個ずつ渡し、事実ごとに違う言い方の質問を BUILDER_PARAPHRASES 個
 * 事実1つにつき質問が10になり、そのうち言い換えの1つを評価用に取っておく (どの事実も学習に残る)。
 * 返事は JSON の形と長さを確かめ、合わないものは理由をつけて捨てる。
 * 作った例は画面で作者が直してから、いつもの学習の流れ (JSONL) に渡す。
 * この中の関数はブラウザとサーバーの両方で使う (Nebius は呼ばない)。
 */

export const BUILDER_ROLE_MAX_CHARS = 1_000;
export const BUILDER_MATERIAL_MAX_CHARS = 48_000;
/** 1回に Nemotron に渡す資料の長さ */
export const BUILDER_CHUNK_CHARS = 4_000;
/** 事実1つに足す言い換えの質問の数 (元の質問と合わせて10。言い換えが多いほど事実を取り出せるようになる) */
export const BUILDER_PARAPHRASES = 9;
/** そのうち、店名などを入れない短い問いの数。指示だけでは長い問いばかりになるので、JSON の欄を分けて求める */
export const BUILDER_SHORT_PARAPHRASES = 4;
/** 1回の言い換えで渡す事実の数。72 問なら出力は 8,000 トークンに収まる */
export const BUILDER_FACTS_PER_CALL = 8;
/** 1回の呼び出しの max_tokens (事実の取り出し / 言い換え) */
export const BUILDER_FACTS_MAX_TOKENS = 12_000;
export const BUILDER_PARAPHRASE_MAX_TOKENS = 8_000;
/** プロンプトの固定部分 (指示) の文字数の見込み。料金の見積もりに使う */
export const BUILDER_PROMPT_OVERHEAD_CHARS = 2_500;
/** 作った例の長さの上限 (これを超えるものは捨てる) */
export const GENERATED_USER_MAX_CHARS = 2_000;
export const GENERATED_ASSISTANT_MAX_CHARS = 6_000;

/** 評価用に取っておく割合と上限 (アップロードしたデータの分け方。上限は作ったデータにも使う) */
export const HELD_OUT_RATIO = 0.15;
export const HELD_OUT_MAX = 50;

const qa = {
  type: "object",
  properties: { question: { type: "string" }, answer: { type: "string" } },
  required: ["question", "answer"],
  additionalProperties: false,
};

const factItem = {
  type: "object",
  properties: { fact: { type: "string" }, ...qa.properties },
  required: ["fact", "question", "answer"],
  additionalProperties: false,
};

/** 事実の取り出しで Token Factory に出させる形 */
export const FACTS_JSON_SCHEMA = {
  name: "facts",
  schema: {
    type: "object",
    properties: {
      facts: { type: "array", items: factItem },
      // 取り違えやすい事実を比べる・まとめる項目。指示だけでは作られないので、形で求める
      contrasts: { type: "array", items: factItem },
      unanswerable: { type: "array", minItems: 1, items: qa },
    },
    required: ["facts", "contrasts", "unanswerable"],
    additionalProperties: false,
  },
};

/** 言い換えで Token Factory に出させる形 (事実の数だけ並べ、事実ごとに questions と short を決まった数ずつ) */
export function paraphraseJsonSchema(factCount: number) {
  return {
    name: "paraphrases",
    schema: {
      type: "object",
      properties: {
        paraphrases: {
          type: "array",
          minItems: factCount,
          maxItems: factCount,
          items: {
            type: "object",
            properties: {
              questions: {
                type: "array",
                minItems: BUILDER_PARAPHRASES - BUILDER_SHORT_PARAPHRASES,
                maxItems: BUILDER_PARAPHRASES - BUILDER_SHORT_PARAPHRASES,
                items: { type: "string" },
              },
              short: {
                type: "array",
                minItems: BUILDER_SHORT_PARAPHRASES,
                maxItems: BUILDER_SHORT_PARAPHRASES,
                items: { type: "string" },
              },
            },
            required: ["questions", "short"],
            additionalProperties: false,
          },
        },
      },
      required: ["paraphrases"],
      additionalProperties: false,
    },
  };
}

export type GeneratedExample = { user: string; assistant: string };
export type BuiltExample = GeneratedExample & { heldOut: boolean };
/** 取り出した事実。questions の先頭が元の質問、続きが言い換え */
export type Fact = { fact: string; answer: string; questions: string[] };

export type DroppedReason = "invalid_json" | "not_object" | "missing_field" | "too_long" | "too_many" | "repeated";

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

/* ---------------------------------------------------------------- 料金の見積もり */

/** 箇条書きの記号・番号・「A:」などの印を外す */
function stripMarker(line: string) {
  return line
    .replace(/^\s*(?:[-*•・●○■□◆◇▶>]|\d+[.)、．]|[（(]?\d+[)）])\s*/u, "")
    .replace(/^\s*(?:A|Ａ|答え?|回答|Answer)\s*\d*\s*[:：.．]\s*/iu, "")
    .trim();
}

/** 質問の行か (FAQ の「Q:」や、？で終わる行)。答えの行と二重に数えないために除く */
function isQuestionLine(line: string) {
  return /^\s*(?:Q|Ｑ|問|質問|Question)\s*\d*\s*[:：.．]/iu.test(line) || /[?？]\s*$/u.test(line);
}

/**
 * かたまりに書かれた事実のおおよその数。
 * 行を文 (。．！! と、後ろに空白のある英文の . ?) に分け、見出し (#)・質問文・文字が4つ未満の断片を除いて数える。
 * 「営業時間：7時〜18時」のような1行1項目の資料も、文章の資料も、だいたい1文を事実1つとして数える。
 */
export function estimateFactCount(chunk: string): number {
  let count = 0;
  for (const raw of chunk.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || isQuestionLine(line)) continue;
    const sentences = stripMarker(line)
      .split(/(?<=[。．！!])|(?<=[.?])(?=\s)/u)
      .filter((sentence) => sentence.replace(/[\s\p{P}\p{S}]/gu, "").length >= 4);
    count += sentences.length;
  }
  return count;
}

type HoldMicros = (input: { inputChars: number; maxTokens: number }) => number;

/** 事実 facts 個を言い換える呼び出しの回数と仮押さえ額 (事実・答え・質問の合計が chars 文字) */
export function estimateParaphrase(facts: number, chars: number, roleChars: number, holdMicros: HoldMicros) {
  const calls = Math.ceil(facts / BUILDER_FACTS_PER_CALL);
  if (calls === 0) return { calls, holdMicros: 0 };
  const hold = holdMicros({
    inputChars: Math.ceil(chars / calls) + roleChars + BUILDER_PROMPT_OVERHEAD_CHARS,
    maxTokens: BUILDER_PARAPHRASE_MAX_TOKENS,
  });
  return { calls, holdMicros: calls * hold };
}

/**
 * 資料から作るときの見込み (作る前に画面に出す)。事実の数は estimateFactCount の見積もりなので、
 * 言い換えの回数は実際に取り出した事実の数で変わる。言い換えに渡す文字数は資料の2倍 (事実 + 答え + 質問) とみる。
 */
export function estimateBuild(chunks: string[], roleChars: number, holdMicros: HoldMicros) {
  const facts = chunks.reduce((sum, chunk) => sum + estimateFactCount(chunk), 0);
  const chars = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const paraphrase = estimateParaphrase(facts, chars * 2, roleChars, holdMicros);
  const extract = chunks.reduce(
    (sum, chunk) =>
      sum +
      holdMicros({
        inputChars: chunk.length + roleChars + BUILDER_PROMPT_OVERHEAD_CHARS,
        maxTokens: BUILDER_FACTS_MAX_TOKENS,
      }),
    0,
  );
  return {
    facts,
    examples: facts * (1 + BUILDER_PARAPHRASES),
    calls: chunks.length + paraphrase.calls,
    holdMicros: extract + paraphrase.holdMicros,
  };
}

/* ---------------------------------------------------------------- 作る流れ */

/** 質問の重複を見るための形 (大文字小文字と空白の違いを無視する) */
export function questionKey(question: string) {
  return question.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * 事実の questions[from..] を例にする。from より前は前回までに例にした分。
 * 質問が3つ以上になった事実は、最後の言い換えを評価用にする (前回までに評価用を選んでいれば選ばない)。
 * 元の質問は評価用にしないので、どの事実も学習に残る。
 */
export function factExamples(fact: Fact, from = 0, allowHeldOut = true): BuiltExample[] {
  const last = fact.questions.length - 1;
  const heldOut = allowHeldOut && from < 3 && last >= 2 ? last : -1;
  return fact.questions
    .slice(from)
    .map((user, index) => ({ user, assistant: fact.answer, heldOut: from + index === heldOut }));
}

export type ExtractResult = {
  facts: Fact[];
  unanswerable: GeneratedExample[];
  dropped: DroppedItem[];
  costMicros: number;
};

export type ParaphraseResult = {
  /** 渡した事実の順に、新しい質問 */
  questions: string[][];
  dropped: DroppedItem[];
  costMicros: number;
};

export type BuildProgress = {
  done: number;
  total: number;
  examples: BuiltExample[];
  dropped: number;
  failed: number;
  costMicros: number;
};

/**
 * 作る流れを1回ずつ順に呼ぶ (画面から使う。extract / paraphrase はサーバーへの1回の依頼)。
 * chunks 個のかたまりから事実を取り出し、facts (前回までの事実) と合わせて言い換える。
 * 「追加で作る」は chunks を 0 にして前回の事実を渡す。言い換えには既にある質問も渡すので、違う言い方が返る。
 * 例は事実ごとに、言い換えが済んだところで出す。止めたとき・失敗したときは、言い換えていない事実も元の質問だけで出す。
 * 重複した質問は existingQuestions も含めて捨てる。評価用は heldOut (既にある数) と合わせて HELD_OUT_MAX まで。
 * isFatal が真の失敗 (残高不足など) なら打ち切り、それ以外の失敗は数えて次へ進む。
 */
export async function runBuild(
  input: { chunks: number; facts?: Fact[]; existingQuestions?: string[]; heldOut?: number },
  hooks: {
    extract: (chunk: number) => Promise<ExtractResult>;
    paraphrase: (facts: Fact[]) => Promise<ParaphraseResult>;
    shouldStop?: () => boolean;
    isFatal?: (error: unknown) => boolean;
    onProgress?: (progress: BuildProgress) => void;
  },
): Promise<BuildProgress & { facts: Fact[]; outcome: "done" | "stopped" | "fatal"; error?: unknown }> {
  const seen = new Set((input.existingQuestions ?? []).map(questionKey));
  const facts = (input.facts ?? []).map((fact) => ({ ...fact, questions: [...fact.questions] }));
  // 事実ごとに、例にした質問の数
  const shown = facts.map((fact) => fact.questions.length);
  let heldOut = input.heldOut ?? 0;
  const batches = () => Math.ceil(facts.length / BUILDER_FACTS_PER_CALL);
  const state: BuildProgress = {
    done: 0,
    total: input.chunks + batches(),
    examples: [],
    dropped: 0,
    failed: 0,
    costMicros: 0,
  };
  const fresh = (question: string) => {
    const key = questionKey(question);
    if (seen.has(key)) {
      state.dropped += 1;
      return false;
    }
    seen.add(key);
    return true;
  };
  const show = (index: number) => {
    const examples = factExamples(facts[index], shown[index], heldOut < HELD_OUT_MAX);
    heldOut += examples.filter((example) => example.heldOut).length;
    state.examples.push(...examples);
    shown[index] = facts[index].questions.length;
  };
  const snapshot = (): BuildProgress => ({ ...state, examples: [...state.examples] });
  const finish = (outcome: "done" | "stopped" | "fatal", error?: unknown) => {
    facts.forEach((_, index) => show(index));
    return { ...snapshot(), facts, outcome, ...(error === undefined ? {} : { error }) };
  };
  const step = async (run: () => Promise<{ dropped: DroppedItem[]; costMicros: number }>) => {
    try {
      const result = await run();
      state.dropped += result.dropped.length;
      state.costMicros += result.costMicros;
    } catch (error) {
      if (hooks.isFatal?.(error)) return { error };
      state.failed += 1;
    }
    return null;
  };

  for (let chunk = 0; chunk < input.chunks; chunk += 1) {
    if (hooks.shouldStop?.()) return finish("stopped");
    const fatal = await step(async () => {
      const result = await hooks.extract(chunk);
      for (const fact of result.facts) {
        if (!fresh(fact.questions[0])) continue;
        facts.push(fact);
        shown.push(0);
      }
      for (const example of result.unanswerable) {
        if (fresh(example.user)) state.examples.push({ ...example, heldOut: false });
      }
      return result;
    });
    if (fatal) return finish("fatal", fatal.error);
    state.done += 1;
    state.total = input.chunks + batches();
    hooks.onProgress?.(snapshot());
  }

  for (let start = 0; start < facts.length; start += BUILDER_FACTS_PER_CALL) {
    if (hooks.shouldStop?.()) return finish("stopped");
    const batch = facts.slice(start, start + BUILDER_FACTS_PER_CALL);
    const fatal = await step(async () => {
      const result = await hooks.paraphrase(batch.map((fact) => ({ ...fact, questions: [...fact.questions] })));
      batch.forEach((fact, index) => fact.questions.push(...(result.questions[index] ?? []).filter(fresh)));
      return result;
    });
    if (fatal) return finish("fatal", fatal.error);
    batch.forEach((_, index) => show(start + index));
    state.done += 1;
    hooks.onProgress?.(snapshot());
  }
  return finish("done");
}

/* ---------------------------------------------------------------- 返事の読み取り */

/** 空でない文字列を整えて返す。長すぎれば "too_long"、文字列でなければ "missing_field" */
function readText(value: unknown, max: number): string | DroppedReason {
  if (typeof value !== "string" || !value.trim()) return "missing_field";
  const text = value.trim();
  return text.length > max ? "too_long" : text;
}

/** 同じ文を2回以上くり返しているか (言い換えが崩れると「How long fresh? How long fresh?」のようになる) */
function isRepeated(text: string) {
  const sentences = text.split(/(?<=[?？。．.!！])\s*/u).map((sentence) => sentence.trim()).filter(Boolean);
  return new Set(sentences).size < sentences.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * 事実の取り出しの返事 ({"facts":[…],"contrasts":[…],"unanswerable":[{question,answer}]}) を読む。
 * contrasts (比べる・まとめる項目) は事実と同じに扱う。
 * 形が違う・空・長すぎるものは捨て、何番目をなぜ捨てたかを返す (番号は facts、contrasts、unanswerable の順に通しで数える)。
 */
export function parseFacts(content: string): {
  facts: Fact[];
  unanswerable: GeneratedExample[];
  dropped: DroppedItem[];
} {
  const parsed = extractJsonObject(content);
  if (!Array.isArray(parsed?.facts)) {
    return { facts: [], unanswerable: [], dropped: [{ index: 0, reason: "invalid_json" }] };
  }
  const items = [...parsed.facts, ...(Array.isArray(parsed.contrasts) ? parsed.contrasts : [])];
  const extra = Array.isArray(parsed.unanswerable) ? parsed.unanswerable : [];
  const facts: Fact[] = [];
  const unanswerable: GeneratedExample[] = [];
  const dropped: DroppedItem[] = [];
  [...items, ...extra].forEach((item: unknown, index) => {
    if (!isRecord(item)) {
      dropped.push({ index, reason: "not_object" });
      return;
    }
    const isFact = index < items.length;
    const fields = [
      readText(item.question, GENERATED_USER_MAX_CHARS),
      readText(item.answer, GENERATED_ASSISTANT_MAX_CHARS),
      isFact ? readText(item.fact, GENERATED_ASSISTANT_MAX_CHARS) : "",
    ];
    const reason = fields.find((field): field is DroppedReason =>
      ["missing_field", "too_long"].includes(field),
    );
    if (reason) {
      dropped.push({ index, reason });
      return;
    }
    const [question, answer, fact] = fields;
    if (isFact) facts.push({ fact, answer, questions: [question] });
    else unanswerable.push({ user: question, assistant: answer });
  });
  return { facts, unanswerable, dropped };
}

/**
 * 言い換えの返事 ({"paraphrases":[{"questions":[...]}]}) を読む。事実 factCount 個の順に、質問の配列を返す。
 * 1事実あたり BUILDER_PARAPHRASES 問まで。形が違う・長すぎる質問は捨てる (番号は事実の番号)。
 */
export function parseParaphrases(
  content: string,
  factCount: number,
): { questions: string[][]; dropped: DroppedItem[] } {
  const questions: string[][] = Array.from({ length: factCount }, () => []);
  const list = extractJsonObject(content)?.paraphrases;
  if (!Array.isArray(list)) return { questions, dropped: [{ index: 0, reason: "invalid_json" }] };
  const dropped: DroppedItem[] = [];
  list.forEach((item: unknown, index) => {
    if (index >= factCount) {
      dropped.push({ index, reason: "too_many" });
      return;
    }
    if (!isRecord(item) || !Array.isArray(item.questions)) {
      dropped.push({ index, reason: isRecord(item) ? "missing_field" : "not_object" });
      return;
    }
    // 短い問いを後ろに置く。評価用は最後の問いなので、短い言い方で確かめることになる
    const values = [...item.questions, ...(Array.isArray(item.short) ? item.short : [])];
    for (const value of values.slice(0, BUILDER_PARAPHRASES)) {
      const text = readText(value, GENERATED_USER_MAX_CHARS);
      if (text === "missing_field" || text === "too_long") dropped.push({ index, reason: text });
      else if (isRepeated(text)) dropped.push({ index, reason: "repeated" });
      else questions[index].push(text);
    }
  });
  return { questions, dropped };
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

/* ---------------------------------------------------------------- アップロードしたデータの分け方 */

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
