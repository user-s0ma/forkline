import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptSecretValue,
  encryptSecretValue,
} from "../src/lib/organization/secret-box";

const KEY = "test-encryption-key-with-at-least-32-characters";

test("シークレットをAES-GCMで暗号化して復号できる", async () => {
  const encrypted = await encryptSecretValue("秘密の値🔐", KEY);
  assert.match(encrypted, /^v1\.[^.]+\.[^.]+$/);
  assert.notEqual(encrypted, "秘密の値🔐");
  assert.equal(await decryptSecretValue(encrypted, KEY), "秘密の値🔐");
});

test("同じ値でもIVが異なる暗号文を生成する", async () => {
  const first = await encryptSecretValue("same", KEY);
  const second = await encryptSecretValue("same", KEY);
  assert.notEqual(first, second);
});

test("短い鍵・異なる鍵・壊れた暗号文を拒否する", async () => {
  await assert.rejects(() => encryptSecretValue("value", "short"), /32/);
  const encrypted = await encryptSecretValue("value", KEY);
  await assert.rejects(() => decryptSecretValue(encrypted, `${KEY}-other`));
  await assert.rejects(
    () => decryptSecretValue("v2.invalid.payload", KEY),
    /unsupported format/,
  );
  await assert.rejects(() => decryptSecretValue("v1.invalid.invalid", KEY));
});
