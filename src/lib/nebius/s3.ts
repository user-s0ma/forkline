/**
 * Nebius Object Storage (S3 互換) を AWS Signature V4 で呼ぶ。Web Crypto だけで動く。
 * https://docs.nebius.com/object-storage/interfaces/s3-api-compatibility.md
 */
import type { NebiusEnv } from "./types";
import { NebiusError, bytesToHex, errorDetail, requireString, trimSlash } from "./http";

const encoder = new TextEncoder();

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, encoder.encode(data));
}

/** S3 のキーをパス用にエンコードする (/ は残す) */
export function encodeS3Key(key: string): string {
  return key
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join("/");
}

export function amzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** SigV4 の Authorization ヘッダーを作る。headers には host と x-amz-* を含める */
export async function signV4(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
  service?: string;
}): Promise<string> {
  const service = input.service ?? "s3";
  const datetime = amzDate(input.date);
  const day = datetime.slice(0, 8);
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) lower[k.toLowerCase()] = v.trim().replace(/\s+/g, " ");
  const names = Object.keys(lower).sort();
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [
    input.method,
    input.url.pathname || "/",
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", datetime, scope, await sha256Hex(canonicalRequest)].join("\n");
  const kDate = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), day);
  const kRegion = await hmac(kDate, input.region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = bytesToHex(await hmac(kSigning, stringToSign));
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function s3Config(env: NebiusEnv): S3Config {
  const endpoint = trimSlash(requireString(env.NEBIUS_S3_ENDPOINT, "NEBIUS_S3_ENDPOINT"));
  if (!/^https?:\/\/[^/\s]+$/.test(endpoint)) {
    throw new NebiusError("Set NEBIUS_S3_ENDPOINT in the form https://storage.<region>.nebius.cloud");
  }
  const bucket = requireString(env.NEBIUS_S3_BUCKET, "NEBIUS_S3_BUCKET");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new NebiusError("Invalid NEBIUS_S3_BUCKET name");
  }
  return {
    endpoint,
    bucket,
    region: requireString(env.NEBIUS_REGION, "NEBIUS_REGION"),
    accessKeyId: requireString(env.NEBIUS_S3_ACCESS_KEY_ID, "NEBIUS_S3_ACCESS_KEY_ID"),
    secretAccessKey: requireString(env.NEBIUS_S3_SECRET_ACCESS_KEY, "NEBIUS_S3_SECRET_ACCESS_KEY"),
  };
}

/** オブジェクトのキーとして安全か (相対パスや空白を許さない) */
export function isSafeKey(key: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,511}$/.test(key) &&
    !key.includes("//") &&
    !key.split("/").some((seg) => seg === "." || seg === "..")
  );
}

export function s3Uri(bucket: string, key: string): string {
  return `s3://${bucket}/${key}`;
}

/** s3://bucket/key を分ける。バケットが env と違えば受け付けない */
export function parseS3Uri(uri: unknown, bucket: string, what: string): string {
  if (typeof uri !== "string") throw new NebiusError(`Invalid ${what}`);
  const prefix = `s3://${bucket}/`;
  if (!uri.startsWith(prefix)) {
    throw new NebiusError(`${what} must start with ${prefix}`);
  }
  const key = uri.slice(prefix.length);
  if (!isSafeKey(key.replace(/\/$/, "")) || key === "") {
    throw new NebiusError(`Invalid ${what} path`);
  }
  return key;
}

export async function s3Request(
  env: NebiusEnv,
  input: { method: "PUT" | "HEAD" | "GET"; key: string; body?: string; contentType?: string },
): Promise<Response> {
  const cfg = s3Config(env);
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${encodeS3Key(input.key)}`);
  const bodyBytes = input.body === undefined ? undefined : encoder.encode(input.body);
  const payloadHash = await sha256Hex(bodyBytes ?? new Uint8Array());
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate(new Date()),
  };
  if (input.contentType) headers["content-type"] = input.contentType;
  const authorization = await signV4({
    method: input.method,
    url,
    headers,
    payloadHash,
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    date: new Date(),
  });
  // host は fetch が付けるので送らない
  const sendHeaders = { ...headers };
  delete (sendHeaders as Partial<typeof headers>).host;
  try {
    return await fetch(url.toString(), {
      method: input.method,
      headers: { ...sendHeaders, Authorization: authorization },
      body: bodyBytes,
    });
  } catch {
    throw new NebiusError("Could not reach Object Storage");
  }
}

export async function s3Put(env: NebiusEnv, key: string, body: string, contentType: string): Promise<void> {
  const res = await s3Request(env, { method: "PUT", key, body, contentType });
  if (!res.ok) {
    const detail = await errorDetail(res, env);
    throw new NebiusError(`Saving to Object Storage failed (${res.status}${detail ? ` ${detail}` : ""})`, res.status);
  }
}

export async function s3Exists(env: NebiusEnv, key: string): Promise<boolean> {
  const res = await s3Request(env, { method: "HEAD", key });
  if (res.ok) return true;
  if (res.status === 404) return false;
  throw new NebiusError(`Could not check Object Storage (${res.status})`, res.status);
}
