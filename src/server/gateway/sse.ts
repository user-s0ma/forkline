import { createThinkingSplitter, splitThinking, type ThinkingSplit } from "@/lib/models/thinking";

export type TokenUsage = { inputTokens: number; outputTokens: number };

type OpenAiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
};

export function readUsage(payload: unknown): TokenUsage | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (payload as { usage?: OpenAiUsage | null }).usage;
  if (!usage || typeof usage !== "object") return null;
  return {
    inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0,
    outputTokens:
      Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0,
  };
}

/** レスポンスの model 名をクリエイターが公開した slug に差し替える (ベースモデル名を露出させない)。 */
export function rewriteModel<T>(payload: T, slug: string): T {
  if (payload && typeof payload === "object" && "model" in payload) {
    return { ...payload, model: slug };
  }
  return payload;
}

type Delta = Record<string, unknown> & { content?: unknown; reasoning_content?: unknown };
type Choice = Record<string, unknown> & { index?: unknown; delta?: Delta; finish_reason?: unknown };
type Chunk = Record<string, unknown> & { id?: unknown; created?: unknown; choices?: unknown };

function withSplit(delta: Delta, split: ThinkingSplit): Delta {
  const next: Delta = { ...delta, content: split.content };
  if (split.reasoning) {
    const before = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
    next.reasoning_content = before + split.reasoning;
  }
  return next;
}

/**
 * ストリームの本文に混ざった <think>…</think> を、OpenAI 互換の reasoning_content に移す。
 * choice ごとに状態を持ち、タグが差分の境目で切れても扱える。
 */
export type ThinkingOptions = { startsInThinking?: boolean };

export function createChunkThinking(slug: string, options: ThinkingOptions = {}) {
  const splitters = new Map<number, ReturnType<typeof createThinkingSplitter>>();
  let last: { id: unknown; created: unknown } = { id: null, created: null };

  const splitterFor = (index: number) => {
    let splitter = splitters.get(index);
    if (!splitter) {
      splitter = createThinkingSplitter(options);
      splitters.set(index, splitter);
    }
    return splitter;
  };

  return {
    apply(chunk: Chunk): Chunk {
      if (!Array.isArray(chunk.choices)) return chunk;
      last = { id: chunk.id ?? last.id, created: chunk.created ?? last.created };
      const choices = (chunk.choices as Choice[]).map((choice, position) => {
        const delta = choice.delta;
        if (!delta || typeof delta.content !== "string") return choice;
        const index = typeof choice.index === "number" ? choice.index : position;
        const splitter = splitterFor(index);
        const split = splitter.push(delta.content);
        // 生成が終わった choice は、持ち越していた分もここで出し切る
        if (choice.finish_reason) {
          const rest = splitter.flush();
          split.reasoning += rest.reasoning;
          split.content += rest.content;
        }
        return { ...choice, delta: withSplit(delta, split) };
      });
      return { ...chunk, choices };
    },
    /** ストリームの終わりに、まだ出していない分を chunk にして返す */
    flush(): Chunk[] {
      const chunks: Chunk[] = [];
      for (const [index, splitter] of splitters) {
        const split = splitter.flush();
        if (!split.reasoning && !split.content) continue;
        chunks.push({
          id: last.id,
          object: "chat.completion.chunk",
          created: last.created,
          model: slug,
          choices: [{ index, delta: withSplit({}, split), finish_reason: null }],
        });
      }
      return chunks;
    },
  };
}

/** 完了済みの chat.completion の本文から思考を reasoning_content に移す */
export function splitCompletionThinking<T>(payload: T, options: ThinkingOptions = {}): T {
  if (!payload || typeof payload !== "object") return payload;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return payload;
  return {
    ...payload,
    choices: choices.map((choice: Record<string, unknown>) => {
      const message = choice.message as Record<string, unknown> | undefined;
      if (!message || typeof message.content !== "string" || message.reasoning_content) {
        return choice;
      }
      const split = splitThinking(message.content, options);
      if (!split.reasoning) return choice;
      return {
        ...choice,
        message: { ...message, content: split.content, reasoning_content: split.reasoning },
      };
    }),
  };
}

/** 1つの chunk で流した文字 (本文・思考・ツール呼び出し) の UTF-8 のバイト数 */
export function chunkContentBytes(chunk: unknown, encoder = new TextEncoder()) {
  if (!chunk || typeof chunk !== "object") return 0;
  const choices = (chunk as Chunk).choices;
  if (!Array.isArray(choices)) return 0;
  let bytes = 0;
  const add = (value: unknown) => {
    if (typeof value === "string") bytes += encoder.encode(value).length;
  };
  for (const choice of choices as Choice[]) {
    const delta = choice?.delta;
    if (!delta || typeof delta !== "object") continue;
    add(delta.content);
    add(delta.reasoning_content);
    const calls = (delta as { tool_calls?: unknown }).tool_calls;
    if (Array.isArray(calls)) {
      for (const call of calls as Array<{ function?: { name?: unknown; arguments?: unknown } }>) {
        add(call?.function?.name);
        add(call?.function?.arguments);
      }
    }
  }
  return bytes;
}

export type StreamSummary = {
  /** 利用者に流した文字のバイト数 (usage が届かずに切れたときの見積もりに使う) */
  contentBytes: number;
  /** 利用者が途中で読むのをやめた */
  cancelled: boolean;
};

/**
 * OpenAI 形式の SSE を行単位で中継しつつ usage を拾うストリーム。
 * 本文に混ざった思考は reasoning_content に移す。
 * ストリーム終了時に onDone が1度だけ呼ばれる。onDone が料金 (円) を返したら、
 * 最後に SSE のコメント行 (`: cost_jpy=…`) として流す。コメント行は SSE の仕様上どのクライアントも読み飛ばす。
 */
export function createUsageTapStream(
  slug: string,
  onDone: (
    usage: TokenUsage | null,
    completed: boolean,
    streamed: StreamSummary,
  ) => number | null | void | Promise<number | null | void>,
  options: ThinkingOptions = {},
) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let usage: TokenUsage | null = null;
  let completed = false;
  let finished = false;
  let contentBytes = 0;
  const thinking = createChunkThinking(slug, options);
  const flushThinking = () =>
    thinking
      .flush()
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join("");

  const processLine = (line: string) => {
    if (!line.startsWith("data:")) return line;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      completed = true;
      return flushThinking() + line;
    }
    try {
      const parsed: unknown = JSON.parse(data);
      usage = readUsage(parsed) ?? usage;
      contentBytes += chunkContentBytes(parsed, encoder);
      const chunk =
        parsed && typeof parsed === "object" ? thinking.apply(parsed as Chunk) : parsed;
      return `data: ${JSON.stringify(rewriteModel(chunk, slug))}`;
    } catch {
      return line;
    }
  };

  const finish = async (cancelled: boolean) => {
    if (finished) return null;
    finished = true;
    return (await onDone(usage, completed, { contentBytes, cancelled })) ?? null;
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      if (lines.length === 0) return;
      controller.enqueue(encoder.encode(lines.map(processLine).join("\n") + "\n"));
    },
    async flush(controller) {
      buffer += decoder.decode();
      if (buffer) controller.enqueue(encoder.encode(processLine(buffer)));
      // [DONE] が来ずに終わったときも、持ち越した分を出し切る
      const rest = flushThinking();
      if (rest) controller.enqueue(encoder.encode(rest));
      const costYen = await finish(false);
      if (costYen !== null) controller.enqueue(encoder.encode(`: cost_jpy=${costYen}\n\n`));
    },
    async cancel() {
      await finish(true);
    },
    // 呼び出し側が途中で切ったときの cancel は Node の TransformStream が呼ぶが、TypeScript の型にはまだない
  } as Transformer<Uint8Array, Uint8Array> & { cancel(): Promise<void> });
}
