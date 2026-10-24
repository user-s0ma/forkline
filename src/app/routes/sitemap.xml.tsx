import {
  DEFAULT_LOCALE,
  LOCALES,
  localePath,
  MARKETING_PATHS,
} from "@/lib/i18n/locales";
import type { Route } from "./+types/sitemap.xml";

export function loader({ request }: Route.LoaderArgs) {
  const base = (
    import.meta.env.VITE_PUBLIC_APP_URL || new URL(request.url).origin
  ).replace(/\/$/, "");

  const alternates = (path: string): string =>
    [
      ...LOCALES.map(
        (l) =>
          `    <xhtml:link rel="alternate" hreflang="${l.value}" href="${base + localePath(path, l.value)}"/>`,
      ),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${base + localePath(path, DEFAULT_LOCALE)}"/>`,
    ].join("\n");

  const entries = MARKETING_PATHS.flatMap((path) =>
    LOCALES.map((l) =>
      [
        "  <url>",
        `    <loc>${base + localePath(path, l.value)}</loc>`,
        alternates(path),
        "  </url>",
      ].join("\n"),
    ),
  ).join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    entries,
    "</urlset>",
    "",
  ].join("\n");

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
