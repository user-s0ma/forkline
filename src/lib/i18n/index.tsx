import { createInstance, type i18n as I18nInstance } from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import ja from "./ja.json";
import en from "./en.json";
import jaSite from "./ja/site.json";
import jaConsole from "./ja/console.json";
import jaStore from "./ja/store.json";
import enSite from "./en/site.json";
import enConsole from "./en/console.json";
import enStore from "./en/store.json";
import {
  DEFAULT_LOCALE,
  htmlLang,
  isMarketingPath,
  localePath,
  LOCALE_COOKIE,
  LOCALE_VALUES,
  logicalPath,
} from "./locales";

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

export const RESOURCES: Record<Locale, Messages> = {
  ja: combine(ja, jaSite, jaConsole, jaStore),
  en: combine(en, enSite, enConsole, enStore),
};

const resources = Object.fromEntries(
  LOCALE_VALUES.map((value) => [value, { translation: RESOURCES[value] }]),
);

export function localeTag(locale: Locale): string {
  return htmlLang(locale);
}

export function createI18n(locale: Locale): I18nInstance {
  const instance = createInstance({
    resources,
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
  });
  instance.use(initReactI18next);
  void instance.init();
  return instance;
}

export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const lookup = (dict: unknown) =>
    key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined,
        dict,
      );
  const value =
    lookup(RESOURCES[locale] ?? RESOURCES[DEFAULT_LOCALE]) ??
    lookup(RESOURCES[DEFAULT_LOCALE]);
  let text = typeof value === "string" ? value : key;
  if (vars) {
    for (const [name, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${name}}}`, String(v));
    }
  }
  return text;
}

export function localeFromMatches(
  matches: ReadonlyArray<{ id: string; loaderData?: unknown } | undefined>,
): Locale {
  const root = matches.find((m) => m?.id === "root");
  return (
    (root?.loaderData as { locale?: Locale } | undefined)?.locale ??
    DEFAULT_LOCALE
  );
}

export function useLocale(): Locale {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  return (LOCALE_VALUES as readonly string[]).includes(lang)
    ? (lang as Locale)
    : DEFAULT_LOCALE;
}

export function switchLocale(i18n: I18nInstance, locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.lang = locale;
  const { pathname, search, hash } = window.location;
  if (isMarketingPath(pathname)) {
    window.location.assign(
      localePath(logicalPath(pathname), locale) + search + hash,
    );
    return;
  }
  void i18n.changeLanguage(locale);
}
