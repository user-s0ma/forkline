import { MARKETING_PATHS } from "@/lib/i18n/locales";
import type { Route } from "./+types/sitemap.xml";

export function loader({ request }: Route.LoaderArgs) {
  const base = (
    import.meta.env.VITE_PUBLIC_APP_URL || new URL(request.url).origin
  ).replace(/\/$/, "");

  const entries = MARKETING_PATHS.map((path) =>
    ["  <url>", `    <loc>${base + path}</loc>`, "  </url>"].join("\n"),
  ).join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
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
