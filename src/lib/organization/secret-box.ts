import { base64ToBytes, bytesToBase64 } from "@/lib/util/encoding";

async function getEncryptionKey(secret: string) {
  if (secret.length < 32) {
    throw new Error("Encryption key must be at least 32 characters");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecretValue(value: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await getEncryptionKey(secret),
    new TextEncoder().encode(value),
  );
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptSecretValue(value: string, secret: string) {
  const [version, encodedIv, encodedValue] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedValue) {
    throw new Error("Encrypted value has an unsupported format");
  }
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(encodedIv) },
    await getEncryptionKey(secret),
    base64ToBytes(encodedValue),
  );
  return new TextDecoder().decode(decrypted);
}
