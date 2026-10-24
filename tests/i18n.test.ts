import assert from "node:assert/strict";
import test from "node:test";
import { RESOURCES, translate } from "../src/lib/i18n";
import { LOCALES } from "../src/lib/i18n/locales";

const KEYS = [
  "site.name",
  "site.metaTitle",
  "site.metaDescription",
  "site.imageAlt",
] as const;

test("サイト共通のメタ情報が全ロケールで埋まっている", () => {
  for (const { value: locale } of LOCALES) {
    for (const key of KEYS) {
      const value = translate(locale, key);
      assert.ok(value.trim().length > 0, `${locale}/${key} が空`);
      assert.notEqual(value, key, `${locale}/${key} が未定義`);
    }
  }
});

test("検索結果で切られない長さに収める", () => {
  for (const { value: locale } of LOCALES) {
    const title = translate(locale, "site.metaTitle");
    const description = translate(locale, "site.metaDescription");
    assert.ok(title.length <= 60, `${locale} title ${title.length}文字`);
    assert.ok(
      description.length <= 160,
      `${locale} description ${description.length}文字`,
    );
  }
});

function flatKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, v]) =>
    flatKeys(v, prefix ? `${prefix}.${key}` : key),
  );
}

const PLURAL_SUFFIX = /_(one|other|two|few|many|zero)$/;

test("日英でキー構成が揃っている", async () => {
  const ja = flatKeys(RESOURCES.ja);
  const en = flatKeys(RESOURCES.en);
  const base = (keys: string[]) =>
    new Set(keys.map((key) => key.replace(PLURAL_SUFFIX, "")));
  const jaBase = base(ja);
  const enBase = base(en);
  const missingInEn = [...jaBase].filter((key) => !enBase.has(key));
  const missingInJa = [...enBase].filter((key) => !jaBase.has(key));
  assert.deepEqual(missingInEn, [], "enに無いキー");
  assert.deepEqual(missingInJa, [], "jaに無いキー");
});
