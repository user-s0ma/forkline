import type { Route } from "./+types/robots.txt";

export function loader({ request }: Route.LoaderArgs) {
  const base = (
    import.meta.env.VITE_PUBLIC_APP_URL || new URL(request.url).origin
  ).replace(/\/$/, "");
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /accept-invitation/",
    "",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
