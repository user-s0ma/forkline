import assert from "node:assert/strict";
import test from "node:test";
import {
  bearerToken,
  generateApiKey,
  hashApiKey,
  isApiKeyFormat,
} from "../src/lib/billing/api-keys";
import {
  defaultModelConfig,
  modelConfigSchema,
  parseModelConfig,
} from "../src/lib/models/config";
import {
  createUsageTapStream,
  readUsage,
  splitCompletionThinking,
} from "../src/server/gateway/sse";
import {
  capTokens,
  chatRequestSchema,
  errorResponse,
  GatewayError,
} from "../src/server/gateway/runtime";

test("APIキーは形式チェックを通り、ハッシュは決定的", async () => {
  const { key, prefix, keyHash } = await generateApiKey();
  assert.ok(isApiKeyFormat(key));
  assert.ok(key.startsWith(prefix));
  assert.equal(keyHash, await hashApiKey(key));
  assert.equal(keyHash.length, 64);
  assert.ok(!isApiKeyFormat("sk-something"));
  assert.equal(bearerToken(`Bearer ${key}`), key);
  assert.equal(bearerToken("Basic abc"), null);
});

async function pipe(chunks: string[], slug: string) {
  let result: { usage: unknown; completed: boolean } | null = null;
  const tap = createUsageTapStream(slug, (usage, completed) => {
    result = { usage, completed };
  });
  const encoder = new TextEncoder();
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const text = await new Response(source.pipeThrough(tap)).text();
  return { text, result: result as { usage: unknown; completed: boolean } | null };
}

test("SSEを中継しながらusageを拾い、model名を差し替える", async () => {
  const { text, result } = await pipe(
    [
      'data: {"id":"1","model":"adapter","choices":[{"delta":{"content":"he',
      'llo"}}]}\n\n',
      'data: {"id":"1","model":"adapter","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":5}}\n\n',
      "data: [DONE]\n\n",
    ],
    "my-model",
  );
  assert.ok(!text.includes('"adapter"'));
  assert.ok(text.includes('"model":"my-model"'));
  assert.ok(text.includes('"content":"hello"'));
  assert.deepEqual(result, { usage: { inputTokens: 12, outputTokens: 5 }, completed: true });
});

test("ストリームの本文の思考を reasoning_content に移す", async () => {
  const event = (content: string, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: "c", model: "m", choices: [{ index: 0, delta: { content }, finish_reason: finish }] })}\n\n`;
  const { text } = await pipe(
    [event("<think>"), event("考え"), event("中</th"), event("ink>\n\n答え", "stop"), "data: [DONE]\n\n"],
    "slug",
  );
  const deltas = text
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)).choices[0].delta);
  assert.equal(deltas.map((d) => d.reasoning_content ?? "").join(""), "考え中");
  assert.equal(deltas.map((d) => d.content ?? "").join(""), "答え");
  assert.ok(!text.includes("<think>") && !text.includes("</think>"));
});

test("完了済みの返答の思考を reasoning_content に移す", () => {
  const payload = {
    choices: [{ index: 0, message: { role: "assistant", content: "<think>考え</think>\n答え" } }],
  };
  assert.deepEqual(splitCompletionThinking(payload).choices[0].message, {
    role: "assistant",
    content: "答え",
    reasoning_content: "考え",
  });
});

test("usageが無い途中終了のストリームも1回だけ通知する", async () => {
  const { result } = await pipe(['data: {"choices":[]}\n'], "m");
  assert.deepEqual(result, { usage: null, completed: false });
});

test("料金が決まったらストリームの最後にSSEのコメント行で流す", async () => {
  const tap = createUsageTapStream("slug", async () => 0.0177);
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const text = await new Response(source.pipeThrough(tap)).text();
  assert.ok(text.endsWith("data: [DONE]\n\n: cost_jpy=0.0177\n\n"));
});

test("usageはOpenAI/Responses両方の形式を読む", () => {
  assert.deepEqual(readUsage({ usage: { input_tokens: 4, output_tokens: 2 } }), {
    inputTokens: 4,
    outputTokens: 2,
  });
  assert.equal(readUsage({}), null);
  assert.equal(readUsage(null), null);
});

test("実行の設定の検証", () => {
  assert.deepEqual(defaultModelConfig(), { maxOutputTokens: 2048 });
  assert.deepEqual(parseModelConfig("{}"), { maxOutputTokens: 2048 });
  assert.deepEqual(parseModelConfig(JSON.stringify({ maxOutputTokens: 512 })), { maxOutputTokens: 512 });
  assert.ok(!modelConfigSchema.safeParse({ maxOutputTokens: 1 }).success);
  assert.ok(!modelConfigSchema.safeParse({ maxOutputTokens: 100_000 }).success);
  assert.equal(parseModelConfig("not json"), null);
});

test("chat/completions の本文を検証し、max_tokens をモデルの上限で抑える", () => {
  const parsed = chatRequestSchema.parse({
    model: "support-bot",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 9999,
    top_p: 0.9,
  });
  assert.equal((parsed as { top_p?: number }).top_p, 0.9);
  assert.equal(capTokens(parsed, 2048), 2048);
  assert.equal(capTokens({ ...parsed, max_tokens: undefined }, 512), 512);
  assert.equal(capTokens({ ...parsed, max_completion_tokens: 100 }, 2048), 100);
  assert.ok(!chatRequestSchema.safeParse({ model: "x", messages: [] }).success);
  assert.ok(
    !chatRequestSchema.safeParse({ model: "x", messages: [{ role: "robot", content: "" }] }).success,
  );
});

test("起動中のエラーは 503 と Retry-After で返す", async () => {
  const response = errorResponse(
    new GatewayError(503, "model_warming_up", "warming", { "Retry-After": "30" }),
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "30");
  assert.deepEqual(await response.json(), {
    error: { message: "warming", type: "model_warming_up", code: "model_warming_up" },
  });
});
