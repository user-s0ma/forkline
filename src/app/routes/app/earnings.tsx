import { useCallback, useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { Check, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LedgerTable } from "@/components/account/LedgerTable";
import {
  DailyBars,
  PanelHeader,
  Stat,
  StatStrip,
} from "@/components/account/shared";
import {
  useErrorToast,
  useAccountPage,
  useYen,
} from "@/components/account/hooks";
import { ListSkeleton } from "@/components/ui/ListSkeleton";
import { PageBody, PageHeader } from "@/components/ui/PageHeader";
import {
  getEarningsSummary,
  getWallet,
  listLedger,
  openPayoutDashboard,
  requestPayout,
  startPayoutOnboarding,
} from "@/lib/api-client";
import { localeTag, useLocale } from "@/lib/i18n";
import { microsToYen, yenToMicros } from "@/lib/billing/pricing";
import { useConfirm } from "@/components/ui/useConfirm";

const CONNECT_STEPS = ["register", "verify", "ready"] as const;

/** Stripe Connect の登録状況を 登録 → 確認 → 出金可能 の順で示す */
function ConnectSteps({ current }: { current: 0 | 1 | 2 }) {
  const { t } = useTranslation();
  return (
    <ol className="grid grid-cols-3 gap-2">
      {CONNECT_STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={step}
            aria-current={active ? "step" : undefined}
            className={`relative pt-4 before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:rounded-full ${
              done
                ? "before:bg-earn"
                : active
                  ? "before:bg-brand-ink"
                  : "before:bg-line"
            }`}
          >
            <span
              className={`flex items-center gap-1.5 text-xs ${
                active
                  ? "font-semibold text-brand-ink"
                  : done
                    ? "text-earn"
                    : "text-ink-mute"
              }`}
            >
              {done && <Check className="h-3.5 w-3.5" aria-hidden />}
              <span className="num">{index + 1}.</span>
              {t(`earnings.steps.${step}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function EarningsPage() {
  const { t } = useTranslation();
  const [confirm, confirmDialog] = useConfirm();
  const locale = useLocale();
  const yen = useYen();
  const numberFormatter = new Intl.NumberFormat(localeTag(locale));
  const { openMobileNavigation } = useAccountPage();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<"connect" | "dashboard" | "payout" | null>(
    null,
  );
  const handledConnect = useRef(false);

  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: () => getWallet(),
  });
  const summary = useQuery({
    queryKey: ["earnings-summary"],
    queryFn: () => getEarningsSummary(),
  });
  const ledger = useInfiniteQuery({
    queryKey: ["ledger", "earnings"],
    queryFn: ({ pageParam }) =>
      listLedger({ cursor: pageParam, pageSize: 50, balance: "earnings" }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  useErrorToast(
    wallet.error ?? summary.error ?? ledger.error,
    t("earnings.loadFailed"),
  );

  const { isFetchingNextPage, fetchNextPage } = ledger;
  const loadMore = useCallback(() => {
    if (!isFetchingNextPage) void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage, isFetchingNextPage]);

  const connectResult = searchParams.get("connect");
  const walletRefetch = wallet.refetch;
  useEffect(() => {
    if (!connectResult || handledConnect.current) return;
    handledConnect.current = true;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("connect");
        return next;
      },
      { replace: true },
    );
    void walletRefetch();
  }, [connectResult, setSearchParams, walletRefetch]);

  const data = wallet.data;
  // 直近の収益は保留中なので、出金できるのはそれを除いた分
  const available = data?.availableEarningsMicros ?? 0;
  const pendingEarnings = data?.pendingEarningsMicros ?? 0;
  const availableYen = Math.floor(microsToYen(available));
  const minYen = data?.limits.payoutMinYen ?? 1_000;
  const amountYen = Number.parseInt(amount, 10);
  const amountValid =
    Number.isInteger(amountYen) && amountYen >= minYen && amountYen <= availableYen;
  // 0=未登録, 1=Stripeで確認中, 2=出金可能
  const connectStep: 0 | 1 | 2 = !data?.connectAccountId
    ? 0
    : !data.payoutsEnabled
      ? 1
      : 2;

  const redirectTo = async (
    kind: "connect" | "dashboard",
    load: () => Promise<{ url: string }>,
  ) => {
    setBusy(kind);
    try {
      const { url } = await load();
      if (kind === "dashboard") {
        window.open(url, "_blank", "noopener,noreferrer");
        setBusy(null);
      } else {
        window.location.assign(url);
      }
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : t("earnings.actionFailed"),
      );
      setBusy(null);
    }
  };

  const handlePayout = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!amountValid || busy) return;
    if (
      !(await confirm(
        t("earnings.payoutConfirm", { amount: yen(yenToMicros(amountYen)) }),
      ))
    ) {
      return;
    }
    setBusy("payout");
    try {
      const result = await requestPayout(amountYen);
      if (!result.ok && result.pending) toast.info(t("earnings.payoutPending"));
      setAmount("");
      await Promise.all([
        walletRefetch(),
        queryClient.invalidateQueries({ queryKey: ["ledger"] }),
      ]);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : t("earnings.payoutFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const earningsLedger = ledger.data?.pages.flatMap((page) => page.items) ?? [];
  const days = summary.data?.days ?? [];
  const earned30 = days.reduce((sum, day) => sum + day.micros, 0);
  const requests30 = days.reduce((sum, day) => sum + day.requests, 0);

  return (
    <>
      {confirmDialog}
      <PageHeader
        title={t("earnings.title")}
        description={t("earnings.description")}
        onOpenMenu={openMobileNavigation}
        actions={
          data?.payoutsEnabled ? (
            <button
              className="console-button-secondary"
              type="button"
              disabled={busy !== null}
              onClick={() => void redirectTo("dashboard", () => openPayoutDashboard())}
            >
              <ExternalLink className="h-4 w-4" />
              {t("earnings.dashboard")}
            </button>
          ) : undefined
        }
      />
      <PageBody>
        <StatStrip cols={3}>
          <Stat
            label={t("earnings.available")}
            value={data ? yen(available) : "—"}
            tone="earn"
          />
          <Stat
            label={t("earnings.earned30")}
            value={summary.data ? yen(earned30) : "—"}
            tone="earn"
          />
          <Stat
            label={t("earnings.requests30")}
            value={summary.data ? numberFormatter.format(requests30) : "—"}
          />
        </StatStrip>

        <section className="console-panel">
          <PanelHeader
            title={t("earnings.payoutTitle")}
            description={
              connectStep === 0
                ? t("earnings.connectIntro")
                : connectStep === 1
                  ? t("earnings.connectPending")
                  : t("earnings.connected")
            }
          />
          <div className="space-y-5 p-4 sm:p-5">
            {!data ? (
              <div className="h-20 animate-pulse rounded-(--radius-control) bg-surface" />
            ) : (
              <>
                <ConnectSteps current={connectStep} />
                {connectStep === 0 ? (
                  <button
                    className="console-button-primary"
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void redirectTo("connect", () => startPayoutOnboarding())
                    }
                  >
                    {busy === "connect"
                      ? t("common.processing")
                      : t("earnings.connect")}
                  </button>
                ) : connectStep === 1 ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="console-button-primary"
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void redirectTo("connect", () => startPayoutOnboarding())
                      }
                    >
                      {busy === "connect"
                        ? t("common.processing")
                        : t("earnings.connectContinue")}
                    </button>
                    <button
                      className="console-button-secondary"
                      type="button"
                      onClick={() => void walletRefetch()}
                    >
                      {t("earnings.refreshStatus")}
                    </button>
                  </div>
                ) : (
                  <form
                    className="flex flex-wrap items-end gap-3"
                    onSubmit={handlePayout}
                  >
                    <label className="block w-full max-w-xs">
                      <span className="console-label">
                        {t("earnings.payoutAmount")}
                      </span>
                      <span className="relative block">
                        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-mute">
                          ¥
                        </span>
                        <input
                          className="console-input num pl-7"
                          type="number"
                          inputMode="numeric"
                          min={minYen}
                          max={availableYen}
                          step={1}
                          value={amount}
                          placeholder={minYen.toLocaleString()}
                          onChange={(event) => setAmount(event.target.value)}
                        />
                      </span>
                    </label>
                    <button
                      className="console-button-secondary"
                      type="button"
                      disabled={availableYen < minYen}
                      onClick={() => setAmount(String(availableYen))}
                    >
                      {t("earnings.payoutAll")}
                    </button>
                    <button
                      className="console-button-primary"
                      type="submit"
                      disabled={!amountValid || busy !== null}
                    >
                      {busy === "payout"
                        ? t("common.processing")
                        : t("earnings.payout")}
                    </button>
                    <span className="pb-2 text-xs text-ink-mute">
                      {t("earnings.minimumShort", { amount: yen(yenToMicros(minYen)) })}
                    </span>
                    {availableYen < minYen && (
                      <p className="w-full text-xs text-ink-mute">
                        {t("earnings.belowMinimum", {
                          min: yen(yenToMicros(minYen)),
                        })}
                      </p>
                    )}
                    {pendingEarnings > 0 && (
                      <p className="w-full text-xs text-ink-mute">
                        {t("earnings.pendingEarnings", {
                          amount: yen(pendingEarnings),
                          days: data?.earningsHoldDays ?? 0,
                        })}
                      </p>
                    )}
                  </form>
                )}
              </>
            )}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="console-panel min-w-0">
            <PanelHeader title={t("earnings.chartTitle")} />
            <div className="p-4 sm:p-5">
              {summary.data ? (
                <DailyBars
                  days={summary.data.days}
                  label={t("earnings.chartTitle")}
                  formatValue={yen}
                  tone="earn"
                />
              ) : (
                <div className="h-40 animate-pulse rounded-(--radius-control) bg-surface" />
              )}
            </div>
          </section>
          <section className="console-panel overflow-hidden">
            <PanelHeader title={t("earnings.byModel")} />
            {!summary.data ? (
              <ListSkeleton rows={3} />
            ) : summary.data.byModel.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-mute">
                {t("earnings.noData")}
              </p>
            ) : (
              <table className="console-table table-fixed">
                <thead>
                  <tr>
                    <th>{t("earnings.columns.model")}</th>
                    <th className="w-16 text-right">
                      {t("earnings.columns.requests")}
                    </th>
                    <th className="w-24 text-right">
                      {t("earnings.columns.earned")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.byModel.map((row) => (
                    <tr key={row.modelId}>
                      <td className="truncate">
                        <Link
                          className="text-brand-ink hover:underline"
                          to={`/app/models/${encodeURIComponent(row.modelId)}`}
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="num text-right text-ink-soft">
                        {numberFormatter.format(row.requests)}
                      </td>
                      <td className="num text-right font-medium text-earn">
                        {yen(row.micros)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <section className="console-panel overflow-hidden">
          <PanelHeader title={t("earnings.historyTitle")} />
          <LedgerTable
            items={earningsLedger}
            isPending={ledger.isPending}
            hasNextPage={Boolean(ledger.hasNextPage)}
            onLoadMore={loadMore}
          />
        </section>
      </PageBody>
    </>
  );
}
