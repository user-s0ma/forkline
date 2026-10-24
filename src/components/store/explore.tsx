import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Boxes, LayoutGrid, Search, SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CATEGORY_ICONS } from "@/components/store/category-icons";
import { ModelCard, ModelCardSkeleton } from "@/components/store/ModelCard";
import { Pagination } from "@/components/store/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { listStoreModels } from "@/lib/api-client";
import { localeTag, localizeHref, useLocale } from "@/lib/i18n";
import { MODEL_CATEGORIES } from "@/lib/billing/pricing";

/*
 * モデル一覧 (検索・カテゴリ・並び順・ページ送り)。
 * 公開ページ (/models) とコンソール (/app/explore) で同じ見た目の部品を使う。
 */

type Sort = "popular" | "new";

const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

export function useExplore() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  // URL の page は 1 始まり、API は 0 始まり
  const page = Math.max(
    1,
    Number.parseInt(searchParams.get("page") ?? "1", 10) || 1,
  );
  const category = searchParams.get("category") ?? "";
  const sort: Sort = searchParams.get("sort") === "new" ? "new" : "popular";
  const [draft, setDraft] = useState(q);

  // 絞り込みや並び順を変えたら1ページ目に戻す
  const updateParams = (next: Record<string, string>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    setSearchParams(params, { replace: true, preventScrollReset: true });
  };

  const goToPage = (next: number) => {
    const params = new URLSearchParams(searchParams);
    if (next > 1) params.set("page", String(next));
    else params.delete("page");
    setSearchParams(params, { preventScrollReset: true });
  };

  // 入力が止まってから検索する
  useEffect(() => {
    if (draft.trim() === q) return;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (draft.trim()) params.set("q", draft.trim());
      else params.delete("q");
      params.delete("page");
      setSearchParams(params, { replace: true, preventScrollReset: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, q, searchParams, setSearchParams]);

  const query = useQuery({
    queryKey: ["store-models", q, category, sort, page],
    queryFn: () => listStoreModels({ q, category, sort, page: page - 1 }),
    placeholderData: keepPreviousData,
  });

  const clearFilters = () => {
    setDraft("");
    updateParams({ q: "", category: "" });
  };

  return {
    draft,
    setDraft,
    category,
    sort,
    page,
    filtered: Boolean(q || category),
    updateParams,
    goToPage,
    clearFilters,
    query,
  };
}

export type ExploreState = ReturnType<typeof useExplore>;

export function ExploreSearch({ state }: { state: ExploreState }) {
  const { t } = useTranslation();
  return (
    <label className="glass relative block max-w-3xl rounded-full border border-line-strong transition-colors focus-within:border-brand-ink">
      <span className="sr-only">{t("store.explore.searchAria")}</span>
      <Search className="pointer-events-none absolute top-1/2 left-5 h-5 w-5 -translate-y-1/2 text-ink-mute" />
      <input
        className="h-14 w-full rounded-full bg-transparent pr-5 pl-13 text-base text-ink outline-none placeholder:text-ink-mute"
        type="search"
        value={state.draft}
        maxLength={100}
        placeholder={t("store.explore.searchPlaceholder")}
        onChange={(event) => state.setDraft(event.target.value)}
      />
    </label>
  );
}

export function ExploreFilters({ state }: { state: ExploreState }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { category, sort, updateParams } = state;
  const data = state.query.data;
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div
        className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0"
        role="group"
        aria-label={t("store.explore.categoriesAria")}
      >
        {(["", ...MODEL_CATEGORIES] as const).map((value) => {
          const active = category === value;
          const Icon = value ? CATEGORY_ICONS[value] : LayoutGrid;
          return (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={active}
              onClick={() => updateParams({ category: value })}
              className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-4 text-sm transition-colors ${
                active
                  ? "border-brand-ink bg-brand-tint font-semibold text-ink"
                  : "border-line text-ink-soft hover:border-line-strong hover:text-ink"
              }`}
            >
              <Icon
                className={`h-4 w-4 ${active ? "text-brand-ink" : "text-ink-mute"}`}
                aria-hidden
              />
              {value
                ? t(`store.categories.${value}`)
                : t("store.explore.allCategories")}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-4 md:shrink-0">
        {data && (
          <span className="num text-sm whitespace-nowrap text-ink-mute">
            {t("store.explore.count", {
              total: new Intl.NumberFormat(localeTag(locale)).format(data.total),
            })}
          </span>
        )}
        <div
          className="ui-tabs min-w-0 flex-1 rounded-full md:w-52 md:flex-none"
          role="group"
          aria-label={t("store.explore.sortAria")}
        >
          {(["popular", "new"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="ui-tab rounded-full"
              aria-pressed={sort === value}
              onClick={() =>
                updateParams({ sort: value === "popular" ? "" : value })
              }
            >
              {value === "popular"
                ? t("store.explore.sortPopular")
                : t("store.explore.sortNew")}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** まだ1つも公開されていないとき。公開までの道筋を示す */
function EmptyCatalog() {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <div className="rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center sm:py-16">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-brand-tint text-brand-ink">
        <Boxes className="h-5 w-5" aria-hidden />
      </span>
      <h2 className="mt-5 text-lg font-semibold text-ink">{t("catalog.emptyTitle")}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-soft">{t("catalog.emptyBody")}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <a className="console-button-primary" href="/app">
          {t("store.explore.publishCta")}
        </a>
        <a className="console-button-secondary" href={localizeHref("/docs#publish", locale)}>
          {t("catalog.emptyDocs")}
        </a>
      </div>
    </div>
  );
}

export function ExploreResults({
  state,
  hrefFor,
}: {
  state: ExploreState;
  /** カードのリンク先 (公開ページとコンソールで変える) */
  hrefFor: (slug: string) => string;
}) {
  const { t } = useTranslation();
  const resultsRef = useRef<HTMLElement>(null);
  const { data, error, isPending } = state.query;
  const models = data?.items ?? [];
  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  return (
    <section
      ref={resultsRef}
      className="mt-8 scroll-mt-24"
      aria-busy={isPending}
    >
      {isPending ? (
        <div className={GRID}>
          {Array.from({ length: 6 }, (_, index) => (
            <ModelCardSkeleton key={index} />
          ))}
        </div>
      ) : error && models.length === 0 ? (
        <EmptyState icon={Boxes} title={t("store.explore.loadError")} />
      ) : models.length === 0 ? (
        state.filtered ? (
          <EmptyState
            icon={SearchX}
            title={t("store.explore.emptyFilteredTitle")}
            description={t("store.explore.emptyFilteredDescription")}
            action={
              <button
                type="button"
                className="console-button-secondary"
                onClick={state.clearFilters}
              >
                {t("store.explore.clearFilters")}
              </button>
            }
          />
        ) : (
          <EmptyCatalog />
        )
      ) : (
        <>
          <div className={GRID}>
            {models.map((model) => (
              <ModelCard
                key={model.slug}
                model={model}
                href={hrefFor(model.slug)}
              />
            ))}
          </div>
          <Pagination
            page={state.page}
            totalPages={totalPages}
            onChange={(next) => {
              state.goToPage(next);
              resultsRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }}
          />
        </>
      )}
    </section>
  );
}
