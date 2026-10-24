import { useTranslation } from "react-i18next";
import type { Route } from "./+types/models";
import { PageBand } from "@/components/landing/PageBand";
import { SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import {
  ExploreFilters,
  ExploreResults,
  ExploreSearch,
  useExplore,
} from "@/components/store/explore";
import {
  localeFromMatches,
  localizeHref,
  translate,
  useLocale,
} from "@/lib/i18n";

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  const locale = localeFromMatches(matches);
  return [
    { title: translate(locale, "store.metaTitle") },
    {
      name: "description",
      content: translate(locale, "store.metaDescription"),
    },
  ];
}

export default function ExploreModels() {
  const { t } = useTranslation();
  const locale = useLocale();
  const state = useExplore();

  return (
    <div className="site min-h-dvh bg-surface font-sans text-ink antialiased">
      <SiteHeader />
      <PageBand
        title={t("store.explore.title")}
        subline={t("store.explore.subtitle")}
      >
        <ExploreSearch state={state} />
      </PageBand>
      <main className="ui-container pt-8 pb-20">
        <ExploreFilters state={state} />
        <ExploreResults
          state={state}
          hrefFor={(slug) =>
            localizeHref(`/models/${encodeURIComponent(slug)}`, locale)
          }
        />
      </main>
      <SiteFooter />
    </div>
  );
}
