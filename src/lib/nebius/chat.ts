/**
 * OpenAI 互換の chat completions を呼ぶ。
 * エンドポイント (vLLM) への中継と、Token Factory の Nemotron の呼び出し。
 * Token Factory: https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion.md
 */
import type { ChatMessage, ChatUsage, NebiusEnv } from "./types";
import { LORA_MODEL_NAME } from "./endpoints";
import { NebiusError, errorDetail, requireString, trimSlash } from "./http";

export const DEFAULT_TOKEN_FACTORY_BASE_URL = "https://api.tokenfactory.nebius.com/v1";
/** Token Factory の Nemotron の model id (2026-10-24 に /v1/models で確かめた) */
export const DEFAULT_TOKEN_FACTORY_MODEL = "nvidia/Nemotron-3_5-Lightning";

const ZERO_USAGE: ChatUsage = { inputTokens: 0, outputTokens: 0 };

/** OpenAI 形式の usage を読む。無ければ null */
export function readUsage(value: unknown): ChatUsage | null {
  const u = (value as { usage?: unknown } | null)?.usage as
    | { prompt_tokens?: unknown; completion_tokens?: unknown }
    | null
    | undefined;
  if (!u || typeof u !== "object") return null;
  const input = typeof u.prompt_tokens === "number" && u.prompt_tokens >= 0 ? Math.floor(u.prompt_tokens) : null;
  const output =
    typeof u.completion_tokens === "number" && u.completion_tokens >= 0 ? Math.floor(u.completion_tokens) : null;
  if (input === null && output === null) return null;
  return { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

function endpointBase(url: unknown): string {
  if (typeof url !== "string") throw new NebiusError("エンドポイントの URL がありません");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new NebiusError("エンドポイントの URL が正しくありません");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new NebiusError("エンドポイントの URL は http(s) にしてください");
  }
  return trimSlash(`${parsed.origin}${parsed.pathname}`);
}

/** 中継する本文を作る。model を LoRA の名前にし、stream なら最後に usage を返させる */
export function buildUpstreamBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NebiusError("リクエストの本文は JSON のオブジェクトにしてください");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new NebiusError("messages が空です");
  }
  const out: Record<string, unknown> = { ...body, model: LORA_MODEL_NAME };
  if (body.stream === true) {
    const prev =
      body.stream_options && typeof body.stream_options === "object" && !Array.isArray(body.stream_options)
        ? (body.stream_options as Record<string, unknown>)
        : {};
    out.stream_options = { ...prev, include_usage: true };
  }
  // LoRA は思考なし (enable_thinking: false) の形で学習しているので、指定が無ければ揃える
  if (body.chat_template_kwargs === undefined) {
    out.chat_template_kwargs = { enable_thinking: false };
  }
  return out;
}

export async function proxyChatCompletion(
  _env: NebiusEnv,
  input: {
    endpointUrl: string;
    /** createEndpoint が返した authToken */
    endpointToken: string;
    body: Record<string, unknown>;
    onUsage: (usage: ChatUsage) => void;
  },
): Promise<Response> {
  let reported = false;
  const report = (usage: ChatUsage | null) => {
    if (reported) return;
    reported = true;
    input.onUsage(usage ?? ZERO_USAGE);
  };

  let base: string;
  let upstreamBody: Record<string, unknown>;
  let token: string;
  try {
    base = endpointBase(input?.endpointUrl);
    token = requireString(input?.endpointToken, "エンドポイントのトークン");
    upstreamBody = buildUpstreamBody(input?.body);
  } catch (e) {
    report(null);
    throw e;
  }
  const stream = upstreamBody.stream === true;

  let res: Response;
  try {
    res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch {
    report(null);
    throw new NebiusError("モデルのエンドポイントにつながりませんでした");
  }

  if (!res.ok || !stream || !res.body) {
    // 失敗や非 stream は本文を読み切ってから usage を知らせる
    const text = await res.text().catch(() => "");
    let usage: ChatUsage | null = null;
    if (res.ok) {
      try {
        usage = readUsage(JSON.parse(text));
      } catch {
        usage = null;
      }
    }
    report(usage);
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  }

  return new Response(passThroughSse(res.body, report), {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

/**
 * SSE をそのまま流しつつ、usage の入った chunk を拾う。
 * 終わり・失敗・取り消しのどれでも report を 1 回だけ呼ぶ。
 */
export function passThroughSse(
  body: ReadableStream<Uint8Array>,
  report: (usage: ChatUsage | null) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: ChatUsage | null = null;
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    try {
      report(usage);
    } catch (e) {
      console.error("onUsage でエラーが起きました", e instanceof Error ? e.message : "");
    }
  };

  const consume = (final: boolean) => {
    const lines = buffer.split("\n");
    buffer = final ? "" : (lines.pop() ?? "");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "" || data === "[DONE]") continue;
      try {
        const found = readUsage(JSON.parse(data));
        if (found) usage = found;
      } catch {
        // JSON でない行は無視して流す
      }
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: end, value } = await reader.read();
        if (end) {
          buffer += decoder.decode();
          consume(true);
          finish();
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        consume(false);
        controller.enqueue(value);
      } catch (e) {
        finish();
        controller.error(e);
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

/** vLLM が LoRA を読み込み終えて応答できるか。起動直後の数分は false になる */
export async function checkEndpointReady(
  _env: NebiusEnv,
  input: { endpointUrl: string; endpointToken: string },
): Promise<boolean> {
  const base = endpointBase(input?.endpointUrl);
  const token = requireString(input?.endpointToken, "エンドポイントのトークン");
  try {
    const res = await fetch(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { data?: { id?: unknown }[] };
    return Array.isArray(json.data) && json.data.some((m) => m?.id === LORA_MODEL_NAME);
  } catch {
    return false;
  }
}

export async function tokenFactoryChat(
  env: NebiusEnv,
  input: {
    model: string;
    messages: ChatMessage[];
    maxTokens?: number;
    /** 返す JSON の形。渡すと Token Factory がその形どおりに出力する (response_format の json_schema) */
    jsonSchema?: { name: string; schema: Record<string, unknown> };
  },
): Promise<{ content: string; usage: ChatUsage }> {
  const apiKey = requireString(env.NEBIUS_TOKEN_FACTORY_API_KEY, "NEBIUS_TOKEN_FACTORY_API_KEY");
  if (typeof input?.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._\-/:]{0,199}$/.test(input.model)) {
    throw new NebiusError("Token Factory のモデル名が正しくありません");
  }
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new NebiusError("messages が空です");
  }
  for (const m of input.messages) {
    if (!["system", "user", "assistant"].includes(m?.role) || typeof m?.content !== "string") {
      throw new NebiusError("messages の形が正しくありません");
    }
  }
  if (
    input.maxTokens !== undefined &&
    (!Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > 32768)
  ) {
    throw new NebiusError("maxTokens は 1 から 32768 の整数にしてください");
  }

  const base = trimSlash(env.NEBIUS_TOKEN_FACTORY_BASE_URL?.trim() || DEFAULT_TOKEN_FACTORY_BASE_URL);
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
    // Nemotron は既定で考えた過程を本文に書き出し、出力の上限を使い切って JSON まで届かないことがある。
    // ここでの用途 (学習データ作り、採点、説明文) は答えだけが要るので、考える過程を止める
    chat_template_kwargs: { enable_thinking: false },
  };
  if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens;
  // 考える過程を止めると JSON の形が崩れやすいので、形を決めて出させる
  if (input.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: input.jsonSchema.name, schema: input.jsonSchema.schema, strict: true },
    };
  }

  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new NebiusError("Token Factory につながりませんでした");
  }
  if (!res.ok) {
    const detail = await errorDetail(res, env);
    throw new NebiusError(`Token Factory の呼び出しに失敗しました (${res.status}${detail ? ` ${detail}` : ""})`, res.status);
  }
  const json = (await res.json().catch(() => null)) as
    | { choices?: { message?: { content?: unknown } }[] }
    | null;
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new NebiusError("Token Factory の応答に本文がありません");
  }
  return { content, usage: readUsage(json) ?? ZERO_USAGE };
}
