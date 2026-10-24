import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test, { afterEach, beforeEach } from "node:test";
import {
  cancelFineTune,
  checkEndpointReady,
  createEndpoint,
  deleteEndpoint,
  getEndpoint,
  getFineTune,
  listNemotronBaseModels,
  proxyChatCompletion,
  startEndpoint,
  startFineTune,
  stopEndpoint,
  tokenFactoryChat,
  uploadTrainingData,
  type ChatUsage,
  type NebiusEnv,
} from "../src/lib/nebius";
import { resetAccessTokenCache, TOKEN_EXCHANGE_URL } from "../src/lib/nebius/auth";
import { signV4 } from "../src/lib/nebius/s3";

/* ---------------------------------------------------------------- 準備 */

const ENV: NebiusEnv = {
  NEBIUS_API_KEY: "test-access-token-0001",
  NEBIUS_PROJECT_ID: "project-e00test",
  NEBIUS_REGION: "eu-north1",
  NEBIUS_S3_ENDPOINT: "https://storage.eu-north1.nebius.cloud",
  NEBIUS_S3_BUCKET: "forkline-test",
  NEBIUS_S3_ACCESS_KEY_ID: "TESTACCESSKEYID0001",
  NEBIUS_S3_SECRET_ACCESS_KEY: "test-secret-access-key-0001",
  NEBIUS_TRAIN_IMAGE: "cr.eu-north1.nebius.cloud/test/forkline-train:0.1",
  NEBIUS_SERVE_IMAGE: "cr.eu-north1.nebius.cloud/test/forkline-serve:0.1",
  NEBIUS_TOKEN_FACTORY_API_KEY: "test-token-factory-key-0001",
};

type Call = { url: string; method: string; headers: Headers; body: string | undefined };

const originalFetch = globalThis.fetch;
let calls: Call[] = [];

/** globalThis.fetch を差し替え、呼ばれた内容を記録する */
function mockFetch(handler: (call: Call) => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let body: string | undefined;
    if (typeof init?.body === "string") body = init.body;
    else if (init?.body instanceof Uint8Array) body = new TextDecoder().decode(init.body);
    const call: Call = { url, method: init?.method ?? "GET", headers: new Headers(init?.headers), body };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  resetAccessTokenCache();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const CHAT_LINE = JSON.stringify({
  messages: [
    { role: "user", content: "こんにちは" },
    { role: "assistant", content: "はい、こんにちは。" },
  ],
});

/* ---------------------------------------------------------------- モデル */

test("Nemotron の一覧はプラットフォーム/プリセットの形で GPU を持つ", () => {
  const models = listNemotronBaseModels();
  assert.ok(models.length >= 2);
  assert.equal(models[0].id, "nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16");
  for (const m of models) {
    assert.match(m.id, /^nvidia\//);
    assert.match(m.trainPreset, /^gpu-[a-z0-9-]+\/\d+gpu-\d+vcpu-\d+gb$/);
    assert.match(m.servePreset, /^gpu-[a-z0-9-]+\/\d+gpu-\d+vcpu-\d+gb$/);
    assert.ok(m.trainUsdPerHour > 0 && m.serveUsdPerHour > 0);
  }
});

/* ---------------------------------------------------------------- Object Storage */

test("SigV4 の署名が AWS の例と一致する", async () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html の GET Object の例
  const auth = await signV4({
    method: "GET",
    url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
    headers: {
      host: "examplebucket.s3.amazonaws.com",
      range: "bytes=0-9",
      "x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "x-amz-date": "20130524T000000Z",
    },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    date: new Date("2013-05-24T00:00:00Z"),
  });
  assert.equal(
    auth,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
      "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
      "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});

test("学習データを署名つきの PUT で置き、s3:// の URI を返す", async () => {
  mockFetch(() => new Response(null, { status: 200 }));
  const jsonl = `${CHAT_LINE}\n${CHAT_LINE}\n`;
  const { datasetUri } = await uploadTrainingData(ENV, { key: "datasets/ft_1/train.jsonl", jsonl });
  assert.equal(datasetUri, "s3://forkline-test/datasets/ft_1/train.jsonl");
  assert.equal(calls.length, 1);
  const [put] = calls;
  assert.equal(put.method, "PUT");
  assert.equal(put.url, "https://storage.eu-north1.nebius.cloud/forkline-test/datasets/ft_1/train.jsonl");
  assert.equal(put.body, jsonl);
  assert.match(
    put.headers.get("authorization") ?? "",
    /^AWS4-HMAC-SHA256 Credential=TESTACCESSKEYID0001\/\d{8}\/eu-north1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
  );
  assert.match(put.headers.get("x-amz-content-sha256") ?? "", /^[0-9a-f]{64}$/);
  assert.ok(!(put.headers.get("authorization") ?? "").includes(ENV.NEBIUS_S3_SECRET_ACCESS_KEY));
});

test("学習データの形が違えば何行目かを示して断る", async () => {
  mockFetch(() => new Response(null, { status: 200 }));
  await assert.rejects(
    () => uploadTrainingData(ENV, { key: "d/train.jsonl", jsonl: `${CHAT_LINE}\n{"messages": [` }),
    /2 行目が JSON として読めません/,
  );
  await assert.rejects(
    () =>
      uploadTrainingData(ENV, {
        key: "d/train.jsonl",
        jsonl: JSON.stringify({ messages: [{ role: "user", content: "a" }] }),
      }),
    /1 行目に assistant の発言がありません/,
  );
  await assert.rejects(() => uploadTrainingData(ENV, { key: "../x.jsonl", jsonl: CHAT_LINE }), /キーが正しくありません/);
  await assert.rejects(() => uploadTrainingData(ENV, { key: "d/x.jsonl", jsonl: "  " }), /空です/);
  assert.equal(calls.length, 0);
});

test("Object Storage の失敗は秘密を伏せた日本語のエラーになる", async () => {
  mockFetch(() =>
    new Response(`<Error><Message>bad key ${ENV.NEBIUS_S3_SECRET_ACCESS_KEY}</Message></Error>`, { status: 403 }),
  );
  await assert.rejects(
    () => uploadTrainingData(ENV, { key: "d/train.jsonl", jsonl: CHAT_LINE }),
    (e: Error) => {
      assert.match(e.message, /Object Storage への保存に失敗しました \(403/);
      assert.ok(!e.message.includes(ENV.NEBIUS_S3_SECRET_ACCESS_KEY));
      return true;
    },
  );
});

/* ---------------------------------------------------------------- 認証 */

function toPem(der: ArrayBuffer, label: string): string {
  const b64 = Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

function decodeJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

test("サービスアカウントの JWT をアクセストークンに替え、使い回す", async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pem = toPem(await crypto.subtle.exportKey("pkcs8", pair.privateKey), "PRIVATE KEY");
  const env: NebiusEnv = {
    ...ENV,
    NEBIUS_API_KEY: undefined,
    NEBIUS_SERVICE_ACCOUNT_ID: "serviceaccount-e00test",
    NEBIUS_AUTHORIZED_KEY_ID: "publickey-e00test",
    // env に入れると改行が \n の文字になることがある
    NEBIUS_AUTHORIZED_PRIVATE_KEY: pem.replace(/\n/g, "\\n"),
  };
  let jwt = "";
  mockFetch(async (call) => {
    if (call.url === TOKEN_EXCHANGE_URL) {
      const form = new URLSearchParams(call.body);
      assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:token-exchange");
      assert.equal(form.get("requested_token_type"), "urn:ietf:params:oauth:token-type:access_token");
      assert.equal(form.get("subject_token_type"), "urn:ietf:params:oauth:token-type:jwt");
      jwt = form.get("subject_token") ?? "";
      return json({ access_token: "exchanged-token", expires_in: 43200, token_type: "Bearer" });
    }
    return json({ status: { state: "RUNNING" } });
  });

  await getFineTune(env, "aijob-e00abc");
  await getFineTune(env, "aijob-e00abc");

  assert.equal(calls.filter((c) => c.url === TOKEN_EXCHANGE_URL).length, 1);
  const api = calls.filter((c) => c.url !== TOKEN_EXCHANGE_URL);
  assert.equal(api.length, 2);
  for (const c of api) assert.equal(c.headers.get("authorization"), "Bearer exchanged-token");

  const [h, p, s] = jwt.split(".");
  assert.deepEqual(decodeJwtPart(h), { alg: "RS256", typ: "JWT", kid: "publickey-e00test" });
  const payload = decodeJwtPart(p);
  assert.equal(payload.iss, "serviceaccount-e00test");
  assert.equal(payload.sub, "serviceaccount-e00test");
  assert.equal(Number(payload.exp) - Number(payload.iat), 300);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    pair.publicKey,
    Buffer.from(s, "base64url"),
    new TextEncoder().encode(`${h}.${p}`),
  );
  assert.ok(ok);
});

test("PKCS#1 の秘密鍵も読める", async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  assert.match(privateKey, /BEGIN RSA PRIVATE KEY/);
  mockFetch((call) =>
    call.url === TOKEN_EXCHANGE_URL ? json({ access_token: "t2", expires_in: 43200 }) : json({}),
  );
  await stopEndpoint(
    {
      ...ENV,
      NEBIUS_SERVICE_ACCOUNT_ID: "serviceaccount-e00x",
      NEBIUS_AUTHORIZED_KEY_ID: "publickey-e00x",
      NEBIUS_AUTHORIZED_PRIVATE_KEY: privateKey,
    },
    "aiendpoint-e00abc",
  );
  assert.equal(calls[1].headers.get("authorization"), "Bearer t2");
});

test("認証情報が無ければ日本語で断る", async () => {
  mockFetch(() => json({}));
  await assert.rejects(() => stopEndpoint({ ...ENV, NEBIUS_API_KEY: undefined }, "aiendpoint-e00abc"), /認証情報がありません/);
  assert.equal(calls.length, 0);
});

/* ---------------------------------------------------------------- 微調整 */

const HP = { epochs: 2, learningRate: 0.0002, loraRank: 16, loraAlpha: 32 };

test("微調整を Job として作る。秘密は環境変数、設定は args で渡す", async () => {
  mockFetch(() => json({ id: "op-1", resourceId: "aijob-e00new" }));
  const { jobId } = await startFineTune(ENV, {
    baseModelId: "nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16",
    datasetUri: "s3://forkline-test/datasets/ft_1/train.jsonl",
    outputPrefix: "adapters/ft_1/",
    hyperparameters: HP,
  });
  assert.equal(jobId, "aijob-e00new");
  const [call] = calls;
  assert.equal(call.method, "POST");
  assert.equal(call.url, "https://api.nebius.cloud/ai/v1/jobs");
  assert.equal(call.headers.get("authorization"), `Bearer ${ENV.NEBIUS_API_KEY}`);
  const body = JSON.parse(call.body ?? "{}");
  assert.equal(body.metadata.parentId, "project-e00test");
  assert.match(body.metadata.name, /^forkline-ft-[0-9a-f]{12}$/);
  assert.equal(body.spec.image, ENV.NEBIUS_TRAIN_IMAGE);
  assert.equal(body.spec.platform, "gpu-l40s-a");
  assert.equal(body.spec.preset, "1gpu-16vcpu-64gb");
  assert.equal(body.spec.timeout, "21600s");
  assert.deepEqual(body.spec.disk, { type: "NETWORK_SSD", sizeBytes: String(200 * 1024 ** 3) });
  assert.match(body.spec.args, /--output-uri s3:\/\/forkline-test\/adapters\/ft_1(\s|$)/);
  assert.match(body.spec.args, /--dataset-uri s3:\/\/forkline-test\/datasets\/ft_1\/train\.jsonl/);
  assert.match(body.spec.args, /--lora-rank 16 --lora-alpha 32/);
  assert.ok(!body.spec.args.includes(ENV.NEBIUS_S3_SECRET_ACCESS_KEY));
  const vars = Object.fromEntries(
    (body.spec.environmentVariables as { name: string; value: string }[]).map((v) => [v.name, v.value]),
  );
  assert.equal(vars.AWS_SECRET_ACCESS_KEY, ENV.NEBIUS_S3_SECRET_ACCESS_KEY);
  assert.equal(vars.S3_ENDPOINT, ENV.NEBIUS_S3_ENDPOINT);
  assert.equal(vars.HF_TOKEN, undefined);
});

test("微調整の入力を確かめる", async () => {
  mockFetch(() => json({ resourceId: "aijob-x" }));
  const base = {
    baseModelId: "nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16",
    datasetUri: "s3://forkline-test/d.jsonl",
    outputPrefix: "adapters/a",
    hyperparameters: HP,
  };
  await assert.rejects(() => startFineTune(ENV, { ...base, baseModelId: "meta/llama" }), /対応していません/);
  await assert.rejects(() => startFineTune(ENV, { ...base, datasetUri: "s3://other/d.jsonl" }), /s3:\/\/forkline-test\//);
  await assert.rejects(() => startFineTune(ENV, { ...base, outputPrefix: "a b" }), /パスが正しくありません/);
  await assert.rejects(() => startFineTune(ENV, { ...base, hyperparameters: { ...HP, loraRank: 7 } }), /loraRank/);
  await assert.rejects(() => startFineTune(ENV, { ...base, hyperparameters: { ...HP, epochs: 0 } }), /epochs/);
  await assert.rejects(
    () => startFineTune({ ...ENV, NEBIUS_TRAIN_IMAGE: undefined }, base),
    /NEBIUS_TRAIN_IMAGE が設定されていません/,
  );
  assert.equal(calls.length, 0);
});

test("ジョブの状態を微調整の状態に読み替える", async () => {
  const cases: [string, string][] = [
    ["PROVISIONING", "queued"],
    ["IMAGE_PULLING", "queued"],
    ["RUNNING", "running"],
    ["CANCELLED", "failed"],
  ];
  for (const [nebiusState, expected] of cases) {
    mockFetch(() => json({ status: { state: nebiusState } }));
    assert.equal((await getFineTune(ENV, "aijob-e00abc")).state, expected);
  }
  mockFetch(() => json({ status: { state: "FAILED", stateDetails: { code: "Error", message: "exit code 1" } } }));
  assert.deepEqual(await getFineTune(ENV, "aijob-e00abc"), {
    state: "failed",
    error: "学習ジョブが失敗しました (Error: exit code 1)",
  });
  assert.equal(calls[0].url, "https://api.nebius.cloud/ai/v1/jobs/aijob-e00abc");
  await assert.rejects(() => getFineTune(ENV, "../x"), /ID が正しくありません/);
});

test("終わったジョブは LoRA のファイルを確かめてから成功にする", async () => {
  const job = {
    spec: { args: "--base-model nvidia/x --output-uri s3://forkline-test/adapters/ft_1 --epochs 1" },
    status: { state: "COMPLETED" },
  };
  mockFetch((call) => (call.method === "HEAD" ? new Response(null, { status: 200 }) : json(job)));
  assert.deepEqual(await getFineTune(ENV, "aijob-e00abc"), {
    state: "succeeded",
    adapterUri: "s3://forkline-test/adapters/ft_1",
  });
  const head = calls.find((c) => c.method === "HEAD");
  assert.equal(head?.url, "https://storage.eu-north1.nebius.cloud/forkline-test/adapters/ft_1/adapter_config.json");

  mockFetch((call) => (call.method === "HEAD" ? new Response(null, { status: 404 }) : json(job)));
  const missing = await getFineTune(ENV, "aijob-e00abc");
  assert.equal(missing.state, "failed");
});

test("微調整の取り消しは cancel を呼ぶ", async () => {
  mockFetch(() => json({ id: "op" }));
  await cancelFineTune(ENV, "aijob-e00abc");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://api.nebius.cloud/ai/v1/jobs/cancel");
  assert.deepEqual(JSON.parse(calls[0].body ?? ""), { id: "aijob-e00abc" });
});

test("Nebius API の失敗は日本語のエラーになり、トークンを含まない", async () => {
  mockFetch(() => json({ code: 3, message: `invalid preset; token=${ENV.NEBIUS_API_KEY}` }, 400));
  await assert.rejects(
    () => cancelFineTune(ENV, "aijob-e00abc"),
    (e: Error) => {
      assert.match(e.message, /Nebius API の呼び出しに失敗しました \(POST \/ai\/v1\/jobs\/cancel: 400 invalid preset/);
      assert.ok(!e.message.includes(ENV.NEBIUS_API_KEY!));
      return true;
    },
  );
});

/* ---------------------------------------------------------------- エンドポイント */

test("エンドポイントを作り、Bearer のトークンを返す", async () => {
  mockFetch(() => json({ id: "op", resourceId: "aiendpoint-e00new" }));
  const { endpointId, authToken } = await createEndpoint(ENV, {
    name: "forkline-My_Model--x",
    baseModelId: "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16",
    adapterUri: "s3://forkline-test/adapters/ft_1",
  });
  assert.equal(endpointId, "aiendpoint-e00new");
  assert.match(authToken, /^[0-9a-f]{64}$/);
  const [call] = calls;
  assert.equal(call.url, "https://api.nebius.cloud/ai/v1/endpoints");
  const body = JSON.parse(call.body ?? "{}");
  assert.equal(body.metadata.name, "forkline-my-model-x");
  assert.equal(body.spec.authToken, authToken);
  assert.equal(body.spec.image, ENV.NEBIUS_SERVE_IMAGE);
  assert.equal(body.spec.platform, "gpu-h100-sxm");
  assert.equal(body.spec.preset, "1gpu-16vcpu-200gb");
  assert.deepEqual(body.spec.ports, [{ containerPort: 8000, protocol: "HTTP" }]);
  assert.match(body.spec.args, /--adapter-uri s3:\/\/forkline-test\/adapters\/ft_1 --lora-name adapter/);
});

test("エンドポイントの状態と URL を読む", async () => {
  mockFetch(() =>
    json({
      status: { state: "RUNNING", publicEndpoints: ["203.0.113.5:8000", "https://aiendpoint-e00new.eu-north1.nebius.cloud/"] },
    }),
  );
  assert.deepEqual(await getEndpoint(ENV, "aiendpoint-e00new"), {
    state: "running",
    url: "https://aiendpoint-e00new.eu-north1.nebius.cloud",
  });
  assert.equal(calls[0].url, "https://api.nebius.cloud/ai/v1/endpoints/aiendpoint-e00new");

  const cases: [string, string][] = [
    ["PROVISIONING", "starting"],
    ["IMAGE_PULLING", "starting"],
    ["STOPPING", "stopping"],
    ["STOPPED", "stopped"],
  ];
  for (const [nebiusState, expected] of cases) {
    mockFetch(() => json({ status: { state: nebiusState } }));
    assert.equal((await getEndpoint(ENV, "aiendpoint-e00new")).state, expected);
  }
  mockFetch(() => json({ status: { state: "RUNNING", publicEndpoints: [] } }));
  assert.equal((await getEndpoint(ENV, "aiendpoint-e00new")).state, "starting");
  mockFetch(() => json({ status: { state: "ERROR", stateDetails: { code: "QuotaExceeded", message: "no gpu" } } }));
  assert.deepEqual(await getEndpoint(ENV, "aiendpoint-e00new"), {
    state: "failed",
    error: "エンドポイントでエラーが起きました (QuotaExceeded: no gpu)",
  });
});

test("エンドポイントの停止・再開・削除", async () => {
  mockFetch(() => json({ id: "op" }));
  await stopEndpoint(ENV, "aiendpoint-e00a");
  await startEndpoint(ENV, "aiendpoint-e00a");
  await deleteEndpoint(ENV, "aiendpoint-e00a");
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url} ${c.body ?? ""}`),
    [
      'POST https://api.nebius.cloud/ai/v1/endpoints/stop {"id":"aiendpoint-e00a"}',
      'POST https://api.nebius.cloud/ai/v1/endpoints/start {"id":"aiendpoint-e00a"}',
      "DELETE https://api.nebius.cloud/ai/v1/endpoints/aiendpoint-e00a ",
    ],
  );
});

/* ---------------------------------------------------------------- 中継 */

const EP_URL = "https://aiendpoint-e00new.eu-north1.nebius.cloud";

test("stream でない中継は model を LoRA にし、usage を 1 回知らせる", async () => {
  const upstream = {
    id: "c1",
    model: "adapter",
    choices: [{ index: 0, message: { role: "assistant", content: "やあ" } }],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
  };
  mockFetch(() => json(upstream));
  const usages: ChatUsage[] = [];
  const res = await proxyChatCompletion(ENV, {
    endpointUrl: `${EP_URL}/`,
    endpointToken: "tok-123",
    body: { model: "someone/model", messages: [{ role: "user", content: "hi" }], max_tokens: 10 },
    onUsage: (u) => usages.push(u),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), upstream);
  assert.deepEqual(usages, [{ inputTokens: 12, outputTokens: 3 }]);
  const [call] = calls;
  assert.equal(call.url, `${EP_URL}/v1/chat/completions`);
  assert.equal(call.headers.get("authorization"), "Bearer tok-123");
  const sent = JSON.parse(call.body ?? "{}");
  assert.equal(sent.model, "adapter");
  assert.equal(sent.max_tokens, 10);
  assert.equal(sent.stream_options, undefined);
  assert.deepEqual(sent.chat_template_kwargs, { enable_thinking: false });
});

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

test("stream の中継は SSE をそのまま流し、最後の usage を 1 回知らせる", async () => {
  const lines = [
    'data: {"choices":[{"index":0,"delta":{"content":"や"}}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{"content":"あ"}}]}\n\nda',
    'ta: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":2,"total_tokens":22}}\n\n',
    "data: [DONE]\n\n",
  ];
  mockFetch(() => sseResponse(lines));
  const usages: ChatUsage[] = [];
  const res = await proxyChatCompletion(ENV, {
    endpointUrl: EP_URL,
    endpointToken: "tok-123",
    body: { messages: [{ role: "user", content: "hi" }], stream: true, chat_template_kwargs: { enable_thinking: true } },
    onUsage: (u) => usages.push(u),
  });
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  assert.deepEqual(usages, []);
  assert.equal(await res.text(), lines.join(""));
  assert.deepEqual(usages, [{ inputTokens: 20, outputTokens: 2 }]);
  const sent = JSON.parse(calls[0].body ?? "{}");
  assert.deepEqual(sent.stream_options, { include_usage: true });
  assert.deepEqual(sent.chat_template_kwargs, { enable_thinking: true });
});

test("stream を途中で切っても usage は 1 回だけ知らせる", async () => {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'));
    },
  });
  mockFetch(() => new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
  const usages: ChatUsage[] = [];
  const res = await proxyChatCompletion(ENV, {
    endpointUrl: EP_URL,
    endpointToken: "tok",
    body: { messages: [{ role: "user", content: "hi" }], stream: true },
    onUsage: (u) => usages.push(u),
  });
  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel();
  assert.deepEqual(usages, [{ inputTokens: 0, outputTokens: 0 }]);
});

test("エンドポイントの失敗は状態をそのまま返し、usage は 0 で知らせる", async () => {
  mockFetch(() => json({ error: { message: "model loading" } }, 503));
  const usages: ChatUsage[] = [];
  const res = await proxyChatCompletion(ENV, {
    endpointUrl: EP_URL,
    endpointToken: "tok",
    body: { messages: [{ role: "user", content: "hi" }], stream: true },
    onUsage: (u) => usages.push(u),
  });
  assert.equal(res.status, 503);
  assert.deepEqual(usages, [{ inputTokens: 0, outputTokens: 0 }]);

  const more: ChatUsage[] = [];
  await assert.rejects(
    () =>
      proxyChatCompletion(ENV, { endpointUrl: "ftp://x", endpointToken: "t", body: { messages: [{}] }, onUsage: (u) => more.push(u) }),
    /http\(s\)/,
  );
  await assert.rejects(
    () => proxyChatCompletion(ENV, { endpointUrl: EP_URL, endpointToken: "t", body: {}, onUsage: (u) => more.push(u) }),
    /messages が空です/,
  );
  assert.equal(more.length, 2);
});

test("LoRA を読み込み終えたかを /v1/models で確かめる", async () => {
  mockFetch(() => json({ data: [{ id: "base" }, { id: "adapter" }] }));
  assert.equal(await checkEndpointReady(ENV, { endpointUrl: EP_URL, endpointToken: "tok" }), true);
  assert.equal(calls[0].url, `${EP_URL}/v1/models`);
  mockFetch(() => json({}, 503));
  assert.equal(await checkEndpointReady(ENV, { endpointUrl: EP_URL, endpointToken: "tok" }), false);
});

/* ---------------------------------------------------------------- Token Factory */

test("Token Factory の Nemotron を呼ぶ", async () => {
  mockFetch(() =>
    json({
      choices: [{ message: { role: "assistant", content: "説明文です" } }],
      usage: { prompt_tokens: 30, completion_tokens: 5 },
    }),
  );
  const out = await tokenFactoryChat(ENV, {
    model: "nvidia/Nemotron-3_5-Lightning",
    messages: [{ role: "user", content: "説明して" }],
    maxTokens: 100,
  });
  assert.deepEqual(out, { content: "説明文です", usage: { inputTokens: 30, outputTokens: 5 } });
  const [call] = calls;
  assert.equal(call.url, "https://api.tokenfactory.nebius.com/v1/chat/completions");
  assert.equal(call.headers.get("authorization"), `Bearer ${ENV.NEBIUS_TOKEN_FACTORY_API_KEY}`);
  assert.deepEqual(JSON.parse(call.body ?? "{}"), {
    model: "nvidia/Nemotron-3_5-Lightning",
    messages: [{ role: "user", content: "説明して" }],
    max_tokens: 100,
  });

  mockFetch(() => json({ detail: "unauthorized" }, 401));
  await assert.rejects(
    () => tokenFactoryChat(ENV, { model: "nvidia/x", messages: [{ role: "user", content: "a" }] }),
    /Token Factory の呼び出しに失敗しました \(401/,
  );
  await assert.rejects(
    () => tokenFactoryChat(ENV, { model: "nvidia/x", messages: [], maxTokens: 1 }),
    /messages が空です/,
  );
});
