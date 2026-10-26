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
import { translate } from "@/lib/i18n";

export function meta(): Route.MetaDescriptors {
  return [
    { title: translate("store.metaTitle") },
    {
      name: "description",
      content: translate("store.metaDescription"),
    },
  ];
}

export default function ExploreModels() {
  const { t } = useTranslation();
  const state = useExplore();

  return (
    <div className="site min-h-dvh bg-surface font-sans text-ink antialiased">
      <SiteHeader />
      <PageBand title={t("store.explore.title")}>
        <ExploreSearch state={state} />
      </PageBand>
      <main className="ui-container pt-8 pb-20">
        <ExploreFilters state={state} />
        <ExploreResults
          state={state}
          hrefFor={(slug) =>
            `/models/${encodeURIComponent(slug)}`
          }
        />
      </main>
      <SiteFooter />
    </div>
  );
}
