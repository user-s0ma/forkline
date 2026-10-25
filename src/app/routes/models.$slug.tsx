import { ArrowLeft, Boxes } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/models.$slug";
import { PageBand } from "@/components/landing/PageBand";
import { SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import {
  DETAIL_LAYOUT,
  ModelDetailBody,
  ModelStats,
  useStoreModel,
} from "@/components/store/ModelDetail";
import { StorePlayground } from "@/components/store/StorePlayground";
import { EmptyState } from "@/components/ui/EmptyState";
import { appContext } from "@/lib/util/app-context";
import { shareMeta } from "@/lib/share-meta";
import { findPublicModel } from "@/server/api/store";
import {
  localeFromMatches,
  localizeHref,
  OG_LOCALE,
  translate,
  useLocale,
} from "@/lib/i18n";

/** リンクを共有したときのタイトル・説明・OG 画像のために、名前と説明だけをサーバーで読む */
export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);
  try {
    const row = await findPublicModel(env, params.slug);
    return row ? { name: row.model.name, tagline: row.model.tagline } : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

export function meta({ matches, params, loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  const locale = localeFromMatches(matches);
  if (!loaderData) {
    return [
      { title: translate(locale, "store.detailMetaTitle") },
      { name: "description", content: translate(locale, "store.metaDescription") },
    ];
  }
  const appUrl = import.meta.env.VITE_PUBLIC_APP_URL ?? "";
  const title = `${loaderData.name} | ${translate(locale, "site.name")}`;
  const description = loaderData.tagline || translate(locale, "store.metaDescription");
  const slug = encodeURIComponent(params.slug);
  return [
    { title },
    { name: "description", content: description },
    ...shareMeta({
      title: `${loaderData.name} | ${translate(OG_LOCALE, "site.name")}`,
      description: loaderData.tagline || translate(OG_LOCALE, "store.metaDescription"),
      url: `${appUrl}/models/${slug}`,
      image: `${appUrl}/api/og/models/${slug}`,
      imageAlt: loaderData.name,
    }),
  ];
}

function DetailSkeleton() {
  return (
    <div className="ui-container pt-10" aria-hidden>
      <div className={DETAIL_LAYOUT}>
        <div className="h-64 animate-pulse rounded-3xl bg-paper" />
        <div className="h-80 animate-pulse rounded-3xl bg-paper" />
      </div>
    </div>
  );
}

export default function ModelDetail({ params }: Route.ComponentProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: model, isPending, notFound } = useStoreModel(params.slug);
  const exploreHref = localizeHref("/models", locale);

  const back = (
    <a
      href={exploreHref}
      className="inline-flex items-center gap-1.5 text-sm text-ink-mute hover:text-brand-ink"
    >
      <ArrowLeft className="h-4 w-4" />
      {t("store.detail.back")}
    </a>
  );

  return (
    <div className="site min-h-dvh bg-surface font-sans text-ink antialiased">
      <SiteHeader />
      {isPending ? (
        <>
          <PageBand
            eyebrow={back}
            title={
              <span className="block h-12 w-2/3 animate-pulse rounded bg-paper" />
            }
          />
          <DetailSkeleton />
        </>
      ) : !model ? (
        <main className="ui-container pt-10 pb-20">
          {back}
          <div className="glow-card mt-6 rounded-3xl">
            <EmptyState
              icon={Boxes}
              title={
                notFound
                  ? t("store.detail.notFoundTitle")
                  : t("store.detail.loadError")
              }
              description={
                notFound ? t("store.detail.notFoundDescription") : undefined
              }
            />
          </div>
        </main>
      ) : (
        <>
          <PageBand
            eyebrow={back}
            title={model.name}
            subline={model.tagline || undefined}
          >
            <ModelStats model={model} />
          </PageBand>
          <main className="ui-container pt-10 pb-20">
            <ModelDetailBody
              model={model}
              tagHref={(tag) => `${exploreHref}?q=${encodeURIComponent(tag)}`}
              playground={
<StorePlayground slug={model.slug} />
              }
            />
          </main>
        </>
      )}
      <SiteFooter />
    </div>
  );
}
