import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
import {
  buildSeo,
  DEFAULT_LOCALE,
  ogLocale,
  resolveLocale,
  translate,
  type SeoTags,
} from "@/lib/i18n";
import { applyThemePref, THEME_INIT_SCRIPT, themePrefFromRequest } from "@/lib/theme";
import { appContext } from "@/lib/util/app-context";
import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-jp";
import "./globals.css";

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  const appUrl = import.meta.env.VITE_PUBLIC_APP_URL;
  const locale = loaderData?.locale ?? DEFAULT_LOCALE;
  const title = translate(locale, "site.metaTitle");
  const description = translate(locale, "site.metaDescription");
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: appUrl },
    { property: "og:site_name", content: translate(locale, "site.name") },
    { property: "og:locale", content: ogLocale(locale) },
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
  const locale = resolveLocale(request);
  const seo = buildSeo(request, import.meta.env.VITE_PUBLIC_APP_URL ?? "");
  const themePref = themePrefFromRequest(request);
  try {
    const { env } = context.get(appContext);
    const session = await auth(env, new URL(request.url).origin).api.getSession(
      {
        headers: request.headers,
      },
    );
    return { session, locale, seo, themePref };
  } catch (error) {
    console.error("Root loader session error:", error);
    return { session: null, locale, seo, themePref };
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
  const data = useRouteLoaderData("root") as
    { locale?: Locale; seo?: SeoTags } | undefined;
  const locale = data?.locale ?? DEFAULT_LOCALE;
  const seo = data?.seo;
  const { i18n } = useTranslation();

  // ハイドレーションで <html> が作り直されても、描画前に表示テーマを付け直す
  useLayoutEffect(() => {
    applyThemePref();
  }, []);

  // 画面で言語を切り替えた直後に、読み込み時の古い言語へ戻さないよう、サーバーの言語が変わったときだけ合わせる
  const syncedLocale = useRef<Locale | null>(null);
  useEffect(() => {
    if (syncedLocale.current === locale) return;
    syncedLocale.current = locale;
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
  }, [i18n, locale]);

  return (
    // data-theme は描画前のスクリプトが付けるので、React の差分チェックから外す
    <html className="" lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        {seo?.noindex && <meta name="robots" content="noindex, nofollow" />}
        {seo?.canonical && <link rel="canonical" href={seo.canonical} />}
        {seo?.alternates.map((alt) => (
          <link
            key={alt.hreflang}
            rel="alternate"
            hrefLang={alt.hreflang}
            href={alt.href}
          />
        ))}
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
