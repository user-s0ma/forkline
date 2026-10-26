import assert from "node:assert/strict";
import test from "node:test";
import { translate } from "../src/lib/i18n";

const KEYS = [
  "site.name",
  "site.metaTitle",
  "site.metaDescription",
  "site.imageAlt",
] as const;

test("サイト共通のメタ情報が埋まっている", () => {
  for (const key of KEYS) {
    const value = translate(key);
    assert.ok(value.trim().length > 0, `${key} が空`);
    assert.notEqual(value, key, `${key} が未定義`);
  }
});

test("検索結果で切られない長さに収める", () => {
  const title = translate("site.metaTitle");
  const description = translate("site.metaDescription");
  assert.ok(title.length <= 60, `title ${title.length}文字`);
  assert.ok(description.length <= 160, `description ${description.length}文字`);
});

test("差し込みの値を埋める", () => {
  assert.equal(translate("common.duration.seconds", { seconds: 5 }), "5s");
});
