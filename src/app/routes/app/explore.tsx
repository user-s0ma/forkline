import { useTranslation } from "react-i18next";
import { useAccountPage } from "@/components/account/hooks";
import {
  ExploreFilters,
  ExploreResults,
  ExploreSearch,
  useExplore,
} from "@/components/store/explore";
import { PageBody, PageHeader } from "@/components/ui/PageHeader";

export default function ConsoleExplorePage() {
  const { t } = useTranslation();
  const { openMobileNavigation } = useAccountPage();
  const state = useExplore();

  return (
    <>
      <PageHeader
        title={t("store.explore.title")}
        onOpenMenu={openMobileNavigation}
      />
      <PageBody>
        <ExploreSearch state={state} />
        <ExploreFilters state={state} />
        <ExploreResults
          state={state}
          hrefFor={(slug) => `/models/${encodeURIComponent(slug)}`}
        />
      </PageBody>
    </>
  );
}
