export const LOCALE_COOKIE = "forkline_locale";

export const DEFAULT_LOCALE: Locale = "ja";
/** 共有したときの表示 (OGP) の言語。閲覧者の言語が分からないため英語に固定する */
export const OG_LOCALE: Locale = "en";

interface LocaleMeta {
  value: Locale;
  label: string;
  flag: string;
  htmlLang: string;
  ogLocale: string;
}

export const LOCALES: readonly LocaleMeta[] = [
  {
    value: "ja",
    label: "日本語",
    flag: "/flags/jp.svg",
    htmlLang: "ja-JP",
    ogLocale: "ja_JP",
  },
  {
    value: "en",
    label: "English",
    flag: "/flags/us.svg",
    htmlLang: "en-US",
    ogLocale: "en_US",
  },
];

export const LOCALE_VALUES: readonly Locale[] = LOCALES.map((l) => l.value);

export const NON_DEFAULT_LOCALES: readonly Locale[] = LOCALE_VALUES.filter(
  (l) => l !== DEFAULT_LOCALE,
);

export const MARKETING_PATHS: readonly string[] = [
  "/",
  "/models",
  "/docs",
  "/terms",
  "/privacy",
  "/tokushoho",
];

function isLocaleValue(value: string): value is Locale {
  return (LOCALE_VALUES as readonly string[]).includes(value);
}

export function htmlLang(locale: Locale): string {
  return LOCALES.find((l) => l.value === locale)?.htmlLang ?? "ja-JP";
}

export function ogLocale(locale: Locale): string {
  return LOCALES.find((l) => l.value === locale)?.ogLocale ?? "ja_JP";
}

export function detectLocale(request?: Request): Locale {
  const cookie = request?.headers.get("cookie") ?? "";
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([a-z-]+)`),
  );
  if (match && isLocaleValue(match[1])) return match[1];
  const accept = request?.headers.get("accept-language") ?? "";
  for (const part of accept.split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLocaleValue(code)) return code;
  }
  return DEFAULT_LOCALE;
}

export function clientLocale(): Locale {
  const lang =
    typeof document !== "undefined" ? document.documentElement.lang : "";
  return isLocaleValue(lang) ? lang : DEFAULT_LOCALE;
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

function localeFromPath(pathname: string): Locale | null {
  const seg = normalizePath(pathname).split("/")[1] ?? "";
  return NON_DEFAULT_LOCALES.includes(seg as Locale) ? (seg as Locale) : null;
}

export function logicalPath(pathname: string): string {
  const p = normalizePath(pathname);
  const loc = localeFromPath(p);
  if (!loc) return p === "" ? "/" : p;
  const stripped = p.slice(loc.length + 1);
  return stripped === "" ? "/" : stripped;
}

export function isMarketingPath(pathname: string): boolean {
  return MARKETING_PATHS.includes(logicalPath(pathname));
}

export function localePath(path: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

export function localizeHref(href: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE || !href.startsWith("/")) return href;
  const path = href.replace(/[?#].*$/, "") || "/";
  if (!isMarketingPath(path)) return href;
  return localePath(path, locale) + href.slice(path.length);
}

export function resolveLocale(request: Request): Locale {
  const { pathname } = new URL(request.url);
  const fromPath = localeFromPath(pathname);
  if (fromPath) return fromPath;
  if (isMarketingPath(pathname)) return DEFAULT_LOCALE;
  return detectLocale(request);
}

export interface SeoTags {
  canonical: string;
  alternates: Array<{ hreflang: string; href: string }>;
  noindex: boolean;
}

export function buildSeo(request: Request, appUrl: string): SeoTags {
  const url = new URL(request.url);
  const base = (appUrl || url.origin).replace(/\/$/, "");
  const pathname = normalizePath(url.pathname);
  if (!isMarketingPath(pathname)) {
    return { canonical: base + pathname, alternates: [], noindex: true };
  }
  const logical = logicalPath(pathname);
  const current = localeFromPath(pathname) ?? DEFAULT_LOCALE;
  const alternates: SeoTags["alternates"] = LOCALES.map((l) => ({
    hreflang: l.value as string,
    href: base + localePath(logical, l.value),
  }));
  alternates.push({
    hreflang: "x-default",
    href: base + localePath(logical, DEFAULT_LOCALE),
  });
  return {
    canonical: base + localePath(logical, current),
    alternates,
    noindex: false,
  };
}
