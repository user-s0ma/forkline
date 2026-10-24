import { bytesToBase64Url } from "../util/encoding";

const KEY_PREFIX = "fk_";

export async function hashApiKey(key: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function generateApiKey() {
  const key = `${KEY_PREFIX}${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
  return { key, prefix: key.slice(0, 10), keyHash: await hashApiKey(key) };
}

export function isApiKeyFormat(value: string) {
  return /^fk_[A-Za-z0-9_-]{43}$/.test(value);
}

export function bearerToken(header: string | null | undefined) {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match?.[1] ?? null;
}
