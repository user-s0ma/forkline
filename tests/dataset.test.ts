import assert from "node:assert/strict";
import test from "node:test";
import {
  checkDataset,
  DATASET_MAX_BYTES,
  DATASET_MIN_EXAMPLES,
  DEFAULT_HYPERPARAMETERS,
  hyperparametersSchema,
} from "../src/lib/models/dataset";
import { sampleJsonl } from "./compute-fakes";

test("正しい chat 形式の JSONL は件数とバイト数を返す (空行は数えない)", () => {
  const jsonl = `${sampleJsonl(12)}\n\n`;
  const check = checkDataset(jsonl);
  assert.equal(check.ok, true);
  assert.equal(check.examples, 12);
  assert.equal(check.bytes, new TextEncoder().encode(jsonl).byteLength);
  assert.deepEqual(check.issues, []);
});

test("行ごとの問題を、何行目かとあわせて返す", () => {
  const lines = sampleJsonl(10).split("\n");
  lines[1] = "{not json";
  lines[3] = JSON.stringify({ messages: [{ role: "user", content: "hi" }] });
  lines[5] = JSON.stringify({ messages: [{ role: "bot", content: "x" }] });
  lines[6] = JSON.stringify({ messages: [{ role: "assistant", content: "only" }] });
  lines[7] = JSON.stringify({ messages: [{ role: "user", content: " " }, { role: "assistant", content: "a" }] });
  lines[8] = JSON.stringify([1, 2]);
  const check = checkDataset(lines.join("\n"));
  assert.equal(check.ok, false);
  assert.deepEqual(check.issues, [
    { code: "invalid_json", line: 2 },
    { code: "no_assistant", line: 4 },
    { code: "invalid_role", line: 6 },
    { code: "no_user", line: 7 },
    { code: "empty_content", line: 8 },
    { code: "not_object", line: 9 },
  ]);
});

test("件数が少なすぎる・大きすぎるデータは断る", () => {
  const few = checkDataset(sampleJsonl(DATASET_MIN_EXAMPLES - 1));
  assert.deepEqual(few.issues, [{ code: "too_few", min: DATASET_MIN_EXAMPLES }]);
  const large = checkDataset("x".repeat(DATASET_MAX_BYTES + 1));
  assert.deepEqual(large.issues, [{ code: "too_large", maxBytes: DATASET_MAX_BYTES }]);
});

test("学習の設定は既定値が通り、範囲外は断る", () => {
  assert.ok(hyperparametersSchema.safeParse(DEFAULT_HYPERPARAMETERS).success);
  assert.ok(!hyperparametersSchema.safeParse({ ...DEFAULT_HYPERPARAMETERS, epochs: 0 }).success);
  assert.ok(!hyperparametersSchema.safeParse({ ...DEFAULT_HYPERPARAMETERS, loraRank: 12 }).success);
  assert.ok(!hyperparametersSchema.safeParse({ ...DEFAULT_HYPERPARAMETERS, learningRate: 1 }).success);
});
