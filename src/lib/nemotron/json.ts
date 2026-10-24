/*
 * Nemotron の返事から JSON を取り出す。返事は信用しない: 思考 (<think>) やコードの囲いを外し、
 * 最初の { から対応する } までだけを JSON として読む。読めなければ null。
 */

/** <think>…</think> を消す。閉じタグだけ残っている (思考の途中から返った) ときは、その後ろだけを使う */
export function stripThinking(text: string) {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const close = out.toLowerCase().lastIndexOf("</think>");
  if (close >= 0) out = out.slice(close + "</think>".length);
  // 閉じないまま終わった思考は、答えが無いものとして捨てる
  const open = out.toLowerCase().indexOf("<think>");
  if (open >= 0) out = out.slice(0, open);
  return out.trim();
}

/** 文字列の中の { } を数えずに、最初の JSON オブジェクトの範囲を探す */
function firstObjectSpan(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  const cleaned = stripThinking(text).replace(/```(?:json)?/gi, "");
  const span = firstObjectSpan(cleaned);
  if (!span) return null;
  try {
    const value = JSON.parse(span) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** 1行の短い文にそろえる (改行や制御文字を消して切り詰める) */
export function oneLine(text: string, max: number) {
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
