/** サイトは英語だけ。数や日付の書式もこの言語に揃える (金額は円のまま) */
export const LOCALE_TAG = "en-US";
export const HTML_LANG = "en";
export const OG_LOCALE = "en_US";

export const MARKETING_PATHS: readonly string[] = [
  "/",
  "/models",
  "/docs",
  "/terms",
  "/privacy",
];

function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

export function isMarketingPath(pathname: string): boolean {
  return MARKETING_PATHS.includes(normalizePath(pathname) || "/");
}

export interface SeoTags {
  canonical: string;
  noindex: boolean;
}

export function buildSeo(request: Request, appUrl: string): SeoTags {
  const url = new URL(request.url);
  const base = (appUrl || url.origin).replace(/\/$/, "");
  const pathname = normalizePath(url.pathname);
  return {
    canonical: base + pathname,
    noindex: !isMarketingPath(pathname),
  };
}
