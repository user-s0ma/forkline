import type { NebiusEnv } from "./types";

/** Nebius とのやりとりで起きた失敗。message は日本語で、秘密は含めない */
export class NebiusError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "NebiusError";
    this.status = status;
  }
}

/** 文字列から env の秘密を伏せる */
export function redact(text: string, env: Partial<NebiusEnv>, extra: string[] = []): string {
  const secrets = [
    env.NEBIUS_API_KEY,
    env.NEBIUS_AUTHORIZED_PRIVATE_KEY,
    env.NEBIUS_S3_ACCESS_KEY_ID,
    env.NEBIUS_S3_SECRET_ACCESS_KEY,
    env.NEBIUS_HF_TOKEN,
    env.NEBIUS_TOKEN_FACTORY_API_KEY,
    ...extra,
  ].filter((s): s is string => typeof s === "string" && s.length >= 8);
  let out = text;
  for (const s of secrets) out = out.split(s).join("***");
  return out;
}

/** 失敗した応答から短い説明を取り出す */
export async function errorDetail(
  res: Response,
  env: Partial<NebiusEnv>,
  extra: string[] = [],
): Promise<string> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return "";
  }
  let detail = text;
  try {
    const json = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (typeof json.message === "string") detail = json.message;
    else if (typeof json.error === "string") detail = json.error;
    else if (json.error && typeof (json.error as { message?: unknown }).message === "string") {
      detail = (json.error as { message: string }).message;
    }
  } catch {
    // JSON でなければ本文をそのまま使う
  }
  return redact(detail.replace(/\s+/g, " ").trim().slice(0, 300), env, extra);
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new NebiusError(`${name} が設定されていません`);
  }
  return value.trim();
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const b of arr) out += b.toString(16).padStart(2, "0");
  return out;
}

export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array | string): string {
  const arr =
    typeof bytes === "string"
      ? new TextEncoder().encode(bytes)
      : bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 推測されにくいランダムな文字列 (hex) */
export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
