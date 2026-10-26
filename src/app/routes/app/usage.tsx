import { useCallback } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DailyBars,
  PanelHeader,
  Stat,
  StatStrip,
} from "@/components/account/shared";
import {
  useDateFormatter,
  useErrorToast,
  useAccountPage,
  useYen,
} from "@/components/account/hooks";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { InfiniteScrollSentinel } from "@/components/ui/InfiniteScrollSentinel";
import { ListSkeleton } from "@/components/ui/ListSkeleton";
import { PageBody, PageHeader } from "@/components/ui/PageHeader";
import { getUsageSummary, listUsage } from "@/lib/api-client";
import { localeTag, useLocale } from "@/lib/i18n";

export default function UsagePage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const yen = useYen();
  const dateFormatter = useDateFormatter();
  const numberFormatter = new Intl.NumberFormat(localeTag(locale));
  const { openMobileNavigation } = useAccountPage();

  const summary = useQuery({
    queryKey: ["usage-summary"],
    queryFn: () => getUsageSummary(),
  });
  const records = useInfiniteQuery({
    queryKey: ["usage"],
    queryFn: ({ pageParam }) =>
      listUsage({ cursor: pageParam, pageSize: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  useErrorToast(summary.error ?? records.error, t("usage.loadFailed"));

  const { isFetchingNextPage, fetchNextPage } = records;
  const loadMore = useCallback(() => {
    if (!isFetchingNextPage) void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage, isFetchingNextPage]);

  const items = records.data?.pages.flatMap((page) => page.items) ?? [];
  const days = summary.data?.days ?? [];
  const totalSpend = days.reduce((sum, day) => sum + day.micros, 0);
  const totalRequests = days.reduce((sum, day) => sum + day.requests, 0);
  const topModel = summary.data?.byModel[0];

  return (
    <>
      <PageHeader
        title={t("usage.title")}
        onOpenMenu={openMobileNavigation}
      />
      <PageBody>
        <StatStrip>
          <Stat
            label={t("usage.spend30")}
            value={summary.data ? yen(totalSpend) : "—"}
          />
          <Stat
            label={t("usage.requests30")}
            value={summary.data ? numberFormatter.format(totalRequests) : "—"}
          />
          <Stat
            label={t("usage.averageCost")}
            value={
              summary.data && totalRequests > 0
                ? yen(Math.round(totalSpend / totalRequests))
                : "—"
            }
          />
          <Stat
            label={t("usage.topModel")}
            value={topModel ? topModel.modelSlug : "—"}
            hint={
              topModel
                ? t("usage.topModelHint", {
                    count: numberFormatter.format(topModel.requests),
                  })
                : undefined
            }
          />
        </StatStrip>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="console-panel min-w-0">
            <PanelHeader title={t("usage.chartTitle")} />
            <div className="p-4 sm:p-5">
              {summary.data ? (
                <DailyBars
                  days={summary.data.days}
                  label={t("usage.chartTitle")}
                  formatValue={yen}
                />
              ) : (
                <div className="h-40 animate-pulse rounded-(--radius-control) bg-surface" />
              )}
            </div>
          </section>
          <section className="console-panel overflow-hidden">
            <PanelHeader title={t("usage.topModels")} />
            {!summary.data ? (
              <ListSkeleton rows={3} />
            ) : summary.data.byModel.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-mute">
                {t("usage.noData")}
              </p>
            ) : (
              <table className="console-table table-fixed">
                <thead>
                  <tr>
                    <th>{t("usage.columns.model")}</th>
                    <th className="w-16 text-right">
                      {t("usage.columns.requests")}
                    </th>
                    <th className="w-24 text-right">{t("usage.columns.cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.byModel.map((row) => (
                    <tr key={row.modelSlug}>
                      <td className="truncate">
                        <a
                          className="flex min-w-0 items-center gap-2.5 font-mono text-xs text-ink hover:text-brand-ink"
                          href={`/models/${encodeURIComponent(row.modelSlug)}`}
                        >
                          <span className="truncate">{row.modelSlug}</span>
                        </a>
                      </td>
                      <td className="num text-right text-ink-soft">
                        {numberFormatter.format(row.requests)}
                      </td>
                      <td className="num text-right">{yen(row.micros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <section className="console-panel overflow-hidden">
          <PanelHeader title={t("usage.historyTitle")} />
          {records.isPending ? (
            <ListSkeleton />
          ) : items.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title={t("usage.emptyTitle")}
              action={
                <a
                  className="console-button-secondary"
                  href="/app/explore"
                >
                  {t("usage.explore")}
                </a>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="console-table sm:min-w-[680px]">
                <thead>
                  <tr>
                    <th>{t("usage.columns.time")}</th>
                    <th>{t("usage.columns.model")}</th>
                    <th className="hidden sm:table-cell">{t("usage.columns.source")}</th>
                    <th className="hidden text-right sm:table-cell">{t("usage.columns.tokens")}</th>
                    <th className="hidden text-right md:table-cell">
                      {t("usage.columns.latency")}
                    </th>
                    <th className="text-right">{t("usage.columns.cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="num whitespace-nowrap text-ink-mute">
                        {dateFormatter.format(new Date(item.createdAt))}
                      </td>
                      <td>
                        <span className="flex items-center gap-2">
                          <a
                            className="truncate font-mono text-xs text-brand-ink hover:underline"
                            href={`/models/${encodeURIComponent(item.modelSlug)}`}
                          >
                            {item.modelSlug}
                          </a>
                          {item.status === "failed" && (
                            <Badge tone="danger">{t("usage.failed")}</Badge>
                          )}
                        </span>
                      </td>
                      <td className="hidden text-ink-soft sm:table-cell">
                        {t(`usage.sources.${item.source}`)}
                      </td>
                      <td className="num hidden whitespace-nowrap text-right text-ink-soft sm:table-cell">
                        {numberFormatter.format(item.inputTokens)} /{" "}
                        {numberFormatter.format(item.outputTokens)}
                      </td>
                      <td className="num hidden text-right text-ink-soft md:table-cell">
                        {t("usage.ms", {
                          value: numberFormatter.format(item.latencyMs),
                        })}
                      </td>
                      <td className="num text-right font-medium">
                        {yen(item.totalMicros)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {records.hasNextPage && (
                <InfiniteScrollSentinel onLoadMore={loadMore} rows={2} />
              )}
            </div>
          )}
        </section>
      </PageBody>
    </>
  );
}
