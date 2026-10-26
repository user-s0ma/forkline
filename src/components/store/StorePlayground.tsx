import { useRouteLoaderData } from "react-router";
import { LogIn } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Playground } from "./Playground";

type RootData = {
  session?: unknown;
};

/**
 * 公開ページ用: ログインを確かめてから Playground を出す。
 * 料金はログインしている人のクレジットから引き落とされる。
 */
export function StorePlayground({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;

  if (!root?.session) {
    const callbackUrl = encodeURIComponent(`/models/${slug}`);
    return (
      <a
        className="ui-button-primary px-5 py-2.5 text-sm"
        href={`/login?callbackUrl=${callbackUrl}`}
      >
        <LogIn className="h-4 w-4" />
        {t("store.playground.login")}
      </a>
    );
  }

  return (
    <div className="space-y-2">
      <Playground slug={slug} />
    </div>
  );
}
