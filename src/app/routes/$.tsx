import { useTranslation } from "react-i18next";
import { PageBand } from "@/components/landing/PageBand";
import { SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";

/** どのページにも当たらない URL は 404 を返す */
export function loader() {
  throw new Response("Not Found", { status: 404 });
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  return (
    <div className="site min-h-screen bg-surface font-sans text-ink antialiased">
      <SiteHeader />
      <PageBand title={t("site.notFound")} size="sm" />
      <SiteFooter />
    </div>
  );
}

export default function CatchAll() {
  return null;
}
