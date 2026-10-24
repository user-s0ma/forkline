import { useRouteLoaderData } from "react-router";
import { LogIn } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Playground } from "./Playground";

type RootData = {
  session?: { session?: { activeOrganizationId?: string | null } } | null;
};

/**
 * 公開ページ用: ログインと組織の選択を確かめてから Playground を出す。
 * 料金はコンソールで選んでいる組織のクレジットから引き落とされる。
 */
export function StorePlayground({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;

  if (!root?.session) {
    const callbackUrl = encodeURIComponent(`/models/${slug}`);
    return (
      <div className="rounded-2xl border border-line bg-surface/60 px-4 py-8 text-center">
        <p className="text-sm font-semibold">{t("store.playground.loginTitle")}</p>
        <a
          className="ui-button-primary mt-4 px-5 py-2.5 text-sm"
          href={`/login?callbackUrl=${callbackUrl}`}
        >
          <LogIn className="h-4 w-4" />
          {t("store.playground.login")}
        </a>
      </div>
    );
  }

  const organizationId = root.session.session?.activeOrganizationId;
  if (!organizationId) {
    return (
      <div className="rounded-2xl border border-line bg-surface/60 px-4 py-8 text-center">
        <p className="text-sm font-semibold">{t("store.playground.chooseOrganization")}</p>
        <a className="ui-button-primary mt-4 px-5 py-2.5 text-sm" href="/app">
          {t("store.playground.openConsole")}
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-mute">{t("store.playground.billedTo")}</p>
      <Playground slug={slug} organizationId={organizationId} />
    </div>
  );
}
