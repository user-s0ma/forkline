import assert from "node:assert/strict";
import test from "node:test";
import { appendDelta } from "../src/components/store/reply";
import { createThinkingSplitter, splitThinking } from "../src/lib/models/thinking";

test("本文の先頭の <think> を思考として分ける", () => {
  assert.deepEqual(splitThinking("<think>考え中</think>\n\n答え"), {
    reasoning: "考え中",
    content: "答え",
  });
  // 生成途中で閉じタグがまだ無いときは全部を思考として扱う
  assert.deepEqual(splitThinking("<think>考え"), { reasoning: "考え", content: "" });
  // 開きタグを省いて閉じタグだけ出すモデル
  assert.deepEqual(splitThinking("考えた</think>答え"), { reasoning: "考えた", content: "答え" });
  assert.deepEqual(splitThinking("ただの答え"), { reasoning: "", content: "ただの答え" });
});

test("ストリームの思考は、タグが差分の境目で切れても分けられる", () => {
  const splitter = createThinkingSplitter();
  const parts = ["", "<th", "ink>\n考え", "ている</th", "ink>\n\n答", "えです"];
  const out = { reasoning: "", content: "" };
  for (const part of parts) {
    const split = splitter.push(part);
    out.reasoning += split.reasoning;
    out.content += split.content;
  }
  const rest = splitter.flush();
  assert.deepEqual(
    { reasoning: out.reasoning + rest.reasoning, content: out.content + rest.content },
    { reasoning: "考えている", content: "答えです" },
  );

  // <think> で始まらない返答はそのまま本文
  const plain = createThinkingSplitter();
  assert.deepEqual(plain.push("こんにちは"), { reasoning: "", content: "こんにちは" });
  assert.deepEqual(plain.push("<think>"), { reasoning: "", content: "<think>" });
});

test("テンプレートが <think> を置くモデルは、開きタグが無くても冒頭から思考として扱う", () => {
  const splitter = createThinkingSplitter({ startsInThinking: true });
  const out = { reasoning: "", content: "" };
  for (const part of ["17*23: ", "391.\n</thi", "nk>\n\n391"]) {
    const split = splitter.push(part);
    out.reasoning += split.reasoning;
    out.content += split.content;
  }
  assert.deepEqual(out, { reasoning: "17*23: 391.\n", content: "391" });
  assert.deepEqual(splitThinking("考えの途中", { startsInThinking: true }), {
    reasoning: "考えの途中",
    content: "",
  });
});

test("ストリームの差分を足し込み、推論パーサーの reasoning もまとめる", () => {
  let state = { raw: "", reasoning: "" };
  let reply;
  for (const delta of [{ reasoning: "まず" }, { reasoning: "整理する" }, { content: "結論" }]) {
    ({ state, reply } = appendDelta(state, delta));
  }
  assert.deepEqual(reply, { reasoning: "まず整理する", content: "結論" });
});
