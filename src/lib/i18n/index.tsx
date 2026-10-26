import { createInstance, type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import common from "./en.json";
import site from "./en/site.json";
import consoleMessages from "./en/console.json";
import store from "./en/store.json";

export * from "./locales";

type Messages = Record<string, unknown>;

function isObject(value: unknown): value is Messages {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 画面ごとに分けた辞書を1つにまとめる。同じ名前空間 (site など) は中まで合わせる */
function combine(...parts: Messages[]): Messages {
  const out: Messages = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      out[key] = isObject(out[key]) && isObject(value) ? combine(out[key], value) : value;
    }
  }
  return out;
}

export const MESSAGES: Messages = combine(common, site, consoleMessages, store);

export function createI18n(): I18nInstance {
  const instance = createInstance({
    resources: { en: { translation: MESSAGES } },
    lng: "en",
    interpolation: { escapeValue: false },
  });
  instance.use(initReactI18next);
  void instance.init();
  return instance;
}

/** React の外 (meta、サーバーの応答、メール) で辞書を引く */
export function translate(
  key: string,
  vars?: Record<string, string | number>,
): string {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      MESSAGES,
    );
  let text = typeof value === "string" ? value : key;
  if (vars) {
    for (const [name, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${name}}}`, String(v));
    }
  }
  return text;
}
