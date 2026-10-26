/**
 * Nebius AI Cloud の REST API に渡すアクセストークンを用意する。
 * サービスアカウントの authorized key で JWT (RS256) を作り、token exchange で 12 時間のトークンに替える。
 * 手順: https://docs.nebius.com/rest-api/authentication.md
 */
import type { NebiusEnv } from "./types";
import { NebiusError, base64UrlEncode, errorDetail, requireString } from "./http";

export const TOKEN_EXCHANGE_URL = "https://auth.eu.nebius.com:443/oauth2/token/exchange";

type Cached = { cacheKey: string; token: string; expiresAt: number };
let cached: Cached | null = null;

/** テスト用。覚えているトークンを捨てる */
export function resetAccessTokenCache(): void {
  cached = null;
}

/** 401 を受けたとき、次の呼び出しで取り直す */
export function invalidateAccessToken(): void {
  cached = null;
}

function hasServiceAccount(env: NebiusEnv): boolean {
  return Boolean(
    env.NEBIUS_SERVICE_ACCOUNT_ID?.trim() &&
      env.NEBIUS_AUTHORIZED_KEY_ID?.trim() &&
      env.NEBIUS_AUTHORIZED_PRIVATE_KEY?.trim(),
  );
}

export async function getAccessToken(env: NebiusEnv): Promise<string> {
  if (!hasServiceAccount(env)) {
    const token = env.NEBIUS_API_KEY?.trim();
    if (!token) {
      throw new NebiusError(
        "Nebius credentials are missing. Set NEBIUS_SERVICE_ACCOUNT_ID / NEBIUS_AUTHORIZED_KEY_ID / NEBIUS_AUTHORIZED_PRIVATE_KEY or NEBIUS_API_KEY",
      );
    }
    return token;
  }

  const saId = requireString(env.NEBIUS_SERVICE_ACCOUNT_ID, "NEBIUS_SERVICE_ACCOUNT_ID");
  const keyId = requireString(env.NEBIUS_AUTHORIZED_KEY_ID, "NEBIUS_AUTHORIZED_KEY_ID");
  const cacheKey = `${saId}:${keyId}`;
  const now = Date.now();
  if (cached && cached.cacheKey === cacheKey && cached.expiresAt > now) {
    return cached.token;
  }

  const jwt = await signServiceAccountJwt({
    serviceAccountId: saId,
    keyId,
    privateKeyPem: requireString(env.NEBIUS_AUTHORIZED_PRIVATE_KEY, "NEBIUS_AUTHORIZED_PRIVATE_KEY"),
    nowSeconds: Math.floor(now / 1000),
  });

  const form = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    subject_token: jwt,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
  });
  let res: Response;
  try {
    res = await fetch(TOKEN_EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch {
    throw new NebiusError("Could not reach the Nebius auth server");
  }
  if (!res.ok) {
    const detail = await errorDetail(res, env, [jwt]);
    throw new NebiusError(`Could not get a Nebius access token (${res.status} ${detail})`, res.status);
  }
  const json = (await res.json().catch(() => null)) as
    | { access_token?: unknown; expires_in?: unknown }
    | null;
  if (!json || typeof json.access_token !== "string" || json.access_token === "") {
    throw new NebiusError("The Nebius auth server response has no access token");
  }
  const expiresIn = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in : 3600;
  // 切れる 5 分前には取り直す
  cached = {
    cacheKey,
    token: json.access_token,
    expiresAt: now + Math.max(60, expiresIn - 300) * 1000,
  };
  return json.access_token;
}

export async function signServiceAccountJwt(input: {
  serviceAccountId: string;
  keyId: string;
  privateKeyPem: string;
  nowSeconds: number;
}): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid: input.keyId };
  const payload = {
    iss: input.serviceAccountId,
    sub: input.serviceAccountId,
    iat: input.nowSeconds,
    exp: input.nowSeconds + 300,
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(input.privateKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new NebiusError("Could not read NEBIUS_AUTHORIZED_PRIVATE_KEY as an RSA private key");
  }
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/** PEM (PKCS#8 か PKCS#1) を PKCS#8 の DER にする */
export function pemToPkcs8(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, "\n").trim();
  const isPkcs1 = normalized.includes("BEGIN RSA PRIVATE KEY");
  const b64 = normalized
    .replace(/-----BEGIN [A-Z ]+-----/, "")
    .replace(/-----END [A-Z ]+-----/, "")
    .replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) {
    throw new NebiusError("NEBIUS_AUTHORIZED_PRIVATE_KEY is not in PEM format");
  }
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  const out = isPkcs1 ? wrapPkcs1(der) : der;
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

function derLength(len: number): number[] {
  if (len < 0x80) return [len];
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function derTlv(tag: number, content: Uint8Array): Uint8Array {
  const len = derLength(content.length);
  const out = new Uint8Array(1 + len.length + content.length);
  out[0] = tag;
  out.set(len, 1);
  out.set(content, 1 + len.length);
  return out;
}

/** PKCS#1 の RSAPrivateKey を PKCS#8 の PrivateKeyInfo で包む */
function wrapPkcs1(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  // rsaEncryption (1.2.840.113549.1.1.1) と NULL
  const algorithm = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);
  const octet = derTlv(0x04, pkcs1);
  const body = new Uint8Array(version.length + algorithm.length + octet.length);
  body.set(version, 0);
  body.set(algorithm, version.length);
  body.set(octet, version.length + algorithm.length);
  return derTlv(0x30, body);
}
