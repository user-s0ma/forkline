/*
 * 推論モデルが本文に混ぜて出す思考 (<think>…</think>) を、本文と分ける。
 * モデル名や実行基盤に頼らず、出力のタグだけを見て判断する。
 * ゲートウェイ (API の返答を OpenAI 互換の reasoning_content にそろえる) と画面の両方で使う。
 */

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

export type ThinkingSplit = { reasoning: string; content: string };

/**
 * 全文から先頭の <think>…</think> を思考として切り出す。
 * 生成途中で閉じタグがまだ無いときは、ここまでを全部思考として扱う。
 * 開きタグをプロンプト側に置き、閉じタグだけを出すモデル (Qwen3 系のテンプレートなど) にも対応する。
 */
export function splitThinking(raw: string, { startsInThinking = false } = {}): ThinkingSplit {
  const text = raw.trimStart();
  const close = text.indexOf(THINK_CLOSE);
  if (text.startsWith(THINK_OPEN)) {
    if (close === -1) return { reasoning: text.slice(THINK_OPEN.length).trim(), content: "" };
    return {
      reasoning: text.slice(THINK_OPEN.length, close).trim(),
      content: text.slice(close + THINK_CLOSE.length).trimStart(),
    };
  }
  if (close !== -1 && !text.slice(0, close).includes(THINK_OPEN)) {
    return {
      reasoning: text.slice(0, close).trim(),
      content: text.slice(close + THINK_CLOSE.length).trimStart(),
    };
  }
  // 思考から始まる形式で閉じタグが無ければ、思考の途中で終わった (上限に達した) とみなす
  if (startsInThinking && !text.includes(THINK_OPEN)) return { reasoning: text.trim(), content: "" };
  return { reasoning: "", content: raw };
}

/** text の末尾が tag の途中までと一致する長さ (差分の境目でタグが切れたときに持ち越す分) */
function partialTagLength(text: string, tag: string) {
  for (let length = Math.min(tag.length - 1, text.length); length > 0; length -= 1) {
    if (tag.startsWith(text.slice(-length))) return length;
  }
  return 0;
}

/**
 * ストリームの差分を順に受け取り、思考と本文に振り分ける。
 * 先頭が <think> で始まるときは思考として扱い、タグが差分の境目で切れても正しく扱う。
 * startsInThinking は、テンプレートが <think> をプロンプト側に置くモデル用。開きタグが無くても冒頭から思考として扱う。
 */
export function createThinkingSplitter({ startsInThinking = false } = {}) {
  let state: "start" | "reasoning" | "content" = "start";
  let pending = "";
  let contentStarted = false;

  const takeContent = (text: string) => {
    if (contentStarted) return text;
    // 閉じタグのあとの改行は本文に含めない
    const trimmed = text.trimStart();
    if (trimmed) contentStarted = true;
    return trimmed;
  };

  const feedReasoning = (text: string): ThinkingSplit => {
    const buffer = pending + text;
    pending = "";
    const close = buffer.indexOf(THINK_CLOSE);
    if (close !== -1) {
      state = "content";
      return {
        reasoning: buffer.slice(0, close),
        content: takeContent(buffer.slice(close + THINK_CLOSE.length)),
      };
    }
    const keep = partialTagLength(buffer, THINK_CLOSE);
    pending = buffer.slice(buffer.length - keep);
    return { reasoning: buffer.slice(0, buffer.length - keep), content: "" };
  };

  return {
    push(text: string): ThinkingSplit {
      if (state === "content") return { reasoning: "", content: takeContent(text) };
      if (state === "reasoning") return feedReasoning(text);
      pending += text;
      const head = pending.trimStart();
      // 開きタグの途中までしか届いていなければ、次の差分を待つ
      if (head.length < THINK_OPEN.length && THINK_OPEN.startsWith(head)) {
        return { reasoning: "", content: "" };
      }
      if (head.startsWith(THINK_OPEN)) {
        state = "reasoning";
        pending = "";
        return feedReasoning(head.slice(THINK_OPEN.length).replace(/^\s+/, ""));
      }
      const rest = pending;
      pending = "";
      if (startsInThinking) {
        state = "reasoning";
        return feedReasoning(rest.replace(/^\s+/, ""));
      }
      state = "content";
      return { reasoning: "", content: takeContent(rest) };
    },
    /** ストリームの終わりに、持ち越していた分を出し切る */
    flush(): ThinkingSplit {
      const rest = pending;
      pending = "";
      if (state === "reasoning") return { reasoning: rest, content: "" };
      return { reasoning: "", content: rest };
    },
  };
}
