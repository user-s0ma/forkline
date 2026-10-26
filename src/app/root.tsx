import { useLayoutEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/root";
import { Toaster } from "sonner";
import { auth } from "@/lib/auth/server";
import { buildSeo, HTML_LANG, OG_LOCALE, translate, type SeoTags } from "@/lib/i18n";
import { applyThemePref, THEME_INIT_SCRIPT, themePrefFromRequest } from "@/lib/theme";
import { appContext } from "@/lib/util/app-context";
import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-jp";
import "./globals.css";

export function meta(): Route.MetaDescriptors {
  const appUrl = import.meta.env.VITE_PUBLIC_APP_URL;
  const title = translate("site.metaTitle");
  const description = translate("site.metaDescription");
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: appUrl },
    { property: "og:site_name", content: translate("site.name") },
    { property: "og:locale", content: OG_LOCALE },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
}

export function links(): Route.LinkDescriptors {
  return [
    { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const seo = buildSeo(request, import.meta.env.VITE_PUBLIC_APP_URL ?? "");
  const themePref = themePrefFromRequest(request);
  try {
    const { env } = context.get(appContext);
    const session = await auth(env, new URL(request.url).origin).api.getSession(
      {
        headers: request.headers,
      },
    );
    return { session, seo, themePref };
  } catch (error) {
    console.error("Root loader session error:", error);
    return { session: null, seo, themePref };
  }
}

export function shouldRevalidate({
  formMethod,
  currentUrl,
  nextUrl,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod !== "GET") return true;
  return currentUrl.toString() === nextUrl.toString();
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData("root") as { seo?: SeoTags } | undefined;
  const seo = data?.seo;

  // ハイドレーションで <html> が作り直されても、描画前に表示テーマを付け直す
  useLayoutEffect(() => {
    applyThemePref();
  }, []);

  return (
    // data-theme は描画前のスクリプトが付けるので、React の差分チェックから外す
    <html className="" lang={HTML_LANG} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        {seo?.noindex && <meta name="robots" content="noindex, nofollow" />}
        {seo?.canonical && <link rel="canonical" href={seo.canonical} />}
        <Meta />
        <Links />
      </head>
      <body className="w-full h-full">
        {children}
        <Toaster richColors position="top-center" />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
