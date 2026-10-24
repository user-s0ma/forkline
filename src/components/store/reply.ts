import { splitThinking } from "@/lib/models/thinking";

/** 返答の本文と思考。思考はゲートウェイが分けた reasoning と、分けきれずに本文に残った <think> の両方を受ける */
export type Reply = { content: string; reasoning: string };

/** ストリームの差分を足し込み、表示用の本文と思考に分ける */
export function appendDelta(
  state: { raw: string; reasoning: string },
  delta: { content?: string; reasoning?: string },
) {
  const next = {
    raw: state.raw + (delta.content ?? ""),
    reasoning: state.reasoning + (delta.reasoning ?? ""),
  };
  const split = splitThinking(next.raw);
  const reply: Reply = {
    content: split.content,
    reasoning: [next.reasoning.trim(), split.reasoning].filter(Boolean).join("\n\n"),
  };
  return { state: next, reply };
}
