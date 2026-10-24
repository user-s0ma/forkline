import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { LogoMark } from "@/components/ui/LogoMark";

type PageHeaderProps = {
  title: ReactNode;
  /** タイトル下の一行説明。そのページで何ができるかを書く */
  description?: ReactNode;
  /** 右側に置く主操作 (ボタンなど) */
  actions?: ReactNode;
  /** 親ページへの戻りリンク (例: モデル一覧) */
  back?: { to: string; label: string };
  onOpenMenu: () => void;
};

/**
 * コンソール共通のページ見出し。
 * モバイルではメニューボタン付きの上部バー、全幅では余白のあるタイトル行になる。
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  onOpenMenu,
}: PageHeaderProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface/95 px-2 backdrop-blur lg:hidden">
        <button
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-(--radius-control) text-ink-soft hover:bg-paper hover:text-ink"
          type="button"
          aria-label={t("common.openMenu")}
          onClick={onOpenMenu}
        >
          <Menu className="h-4 w-4" />
        </button>
        {/* ページ名はすぐ下の見出しに出るので、バーにはロゴだけを置く */}
        <Link to="/app" className="flex items-center gap-2 text-ink" aria-label="Forkline">
          <LogoMark />
          <span className="text-[15px] font-bold tracking-[-0.02em]">Forkline</span>
        </Link>
      </div>
      <header>
        <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-5 sm:px-8 lg:pt-8">
          {back && (
            <Link
              to={back.to}
              className="mb-3 inline-flex text-sm text-ink-mute hover:text-brand-ink"
            >
              {back.label}
            </Link>
          )}
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-[-0.015em] text-ink">
                {title}
              </h1>
              {description && (
                <div className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-mute">
                  {description}
                </div>
              )}
            </div>
            {actions && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {actions}
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

/** ページ本文のコンテナ。PageHeader と同じ幅・余白に揃える */
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 pb-16 sm:px-8">
      {children}
    </main>
  );
}
