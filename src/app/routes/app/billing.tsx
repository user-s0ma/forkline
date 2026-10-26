import { useCallback, useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LedgerTable } from "@/components/account/LedgerTable";
import { PanelHeader } from "@/components/account/shared";
import {
  useErrorToast,
  useAccountPage,
  useYen,
} from "@/components/account/hooks";
import { PageBody, PageHeader } from "@/components/ui/PageHeader";
import { getWallet, listLedger, startTopup } from "@/lib/api-client";
import { yenToMicros } from "@/lib/billing/pricing";

const PRESETS = [1_000, 5_000, 10_000] as const;
type Choice = (typeof PRESETS)[number] | "custom";
const POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 2_000;

export default function CreditsPage() {
  const { t } = useTranslation();
  const yen = useYen();
  const { openMobileNavigation } = useAccountPage();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [choice, setChoice] = useState<Choice>(PRESETS[1]);
  const [custom, setCustom] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const handledTopup = useRef(false);

  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: () => getWallet(),
  });
  const ledger = useInfiniteQuery({
    queryKey: ["ledger", "credit"],
    queryFn: ({ pageParam }) =>
      listLedger({ cursor: pageParam, pageSize: 50, balance: "credit" }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  useErrorToast(wallet.error ?? ledger.error, t("credits.loadFailed"));

  const { isFetchingNextPage, fetchNextPage } = ledger;
  const loadMore = useCallback(() => {
    if (!isFetchingNextPage) void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage, isFetchingNextPage]);

  // Stripe から戻ってきた直後は Webhook の反映を待つため数回ポーリングする
  const topupResult = searchParams.get("topup");
  const walletRefetch = wallet.refetch;
  useEffect(() => {
    if (!topupResult || handledTopup.current) return;
    handledTopup.current = true;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("topup");
        return next;
      },
      { replace: true },
    );
    if (topupResult === "cancel") {
      toast.info(t("credits.topupCanceled"));
      return;
    }
    if (topupResult !== "success") return;
    let attempts = 0;
    let startingCredit: number | undefined;
    const timer = window.setInterval(() => {
      attempts += 1;
      void walletRefetch().then(({ data }) => {
        if (startingCredit === undefined) startingCredit = data?.creditMicros;
        else if (data && data.creditMicros !== startingCredit) {
          window.clearInterval(timer);
        }
      });
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
      if (attempts >= POLL_ATTEMPTS) window.clearInterval(timer);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [queryClient, setSearchParams, t, topupResult, walletRefetch]);

  const limits = wallet.data?.limits ?? {
    topupMinYen: 500,
    topupMaxYen: 100_000,
    payoutMinYen: 1_000,
  };
  const selectedAmount =
    choice === "custom" ? Number.parseInt(custom, 10) : choice;
  const amountValid =
    Number.isInteger(selectedAmount) &&
    selectedAmount >= limits.topupMinYen &&
    selectedAmount <= limits.topupMaxYen;

  const handleTopup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!amountValid || isStarting) return;
    setIsStarting(true);
    try {
      const { url } = await startTopup(selectedAmount);
      window.location.assign(url);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : t("credits.topupFailed"),
      );
      setIsStarting(false);
    }
  };

  const ledgerItems = ledger.data?.pages.flatMap((page) => page.items) ?? [];
  const rangeText = t("credits.amountRange", {
    min: yen(yenToMicros(limits.topupMinYen)),
    max: yen(yenToMicros(limits.topupMaxYen)),
  });

  return (
    <>
      <PageHeader
        title={t("credits.title")}
        description={t("credits.description")}
        onOpenMenu={openMobileNavigation}
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <section className="console-panel flex flex-col p-5">
            <p className="text-xs text-ink-mute">{t("credits.balance")}</p>
            <p className="num mt-2 text-4xl font-semibold tracking-[-0.02em] text-brand-ink">
              {wallet.data ? yen(wallet.data.creditMicros) : "—"}
            </p>
            {wallet.data && wallet.data.heldMicros > 0 && (
              <p className="num mt-2 text-xs text-ink-mute">
                {t("credits.held", { amount: yen(wallet.data.heldMicros) })}
              </p>
            )}
          </section>

          <form className="console-panel" onSubmit={handleTopup}>
            <PanelHeader
              title={t("credits.topupTitle")}
              description={rangeText}
            />
            <div className="space-y-4 p-4 sm:p-5">
              {/* スマホでは4つを1列に並べると文字が折れるので2×2にする */}
              <div
                className="ui-tabs grid grid-cols-2 sm:flex"
                role="radiogroup"
                aria-label={t("credits.topupTitle")}
              >
                {[...PRESETS, "custom" as const].map((option) => (
                  <button
                    key={option}
                    className="ui-tab num whitespace-nowrap"
                    type="button"
                    role="radio"
                    aria-checked={choice === option}
                    aria-pressed={choice === option}
                    onClick={() => setChoice(option)}
                  >
                    {option === "custom"
                      ? t("credits.customOption")
                      : yen(yenToMicros(option))}
                  </button>
                ))}
              </div>
              {choice === "custom" && (
                <label className="block">
                  <span className="console-label">{t("credits.customAmount")}</span>
                  <span className="relative block max-w-xs">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-mute">
                      ¥
                    </span>
                    <input
                      className="console-input num pl-7"
                      type="number"
                      inputMode="numeric"
                      min={limits.topupMinYen}
                      max={limits.topupMaxYen}
                      step={1}
                      value={custom}
                      autoFocus
                      aria-invalid={Boolean(custom) && !amountValid}
                      placeholder={limits.topupMinYen.toLocaleString()}
                      onChange={(event) => setCustom(event.target.value)}
                    />
                  </span>
                  {custom && !amountValid && (
                    <span className="console-hint text-danger!">{rangeText}</span>
                  )}
                </label>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <div>
                  <p className="text-xs text-ink-mute">{t("credits.payAmount")}</p>
                  <p className="num text-2xl font-semibold">
                    {amountValid ? yen(yenToMicros(selectedAmount)) : "—"}
                  </p>
                </div>
                <button
                  className="console-button-primary"
                  type="submit"
                  disabled={!amountValid || isStarting}
                >
                  {isStarting ? t("common.processing") : t("credits.payWithStripe")}
                </button>
              </div>
            </div>
          </form>
        </div>

        <section className="console-panel overflow-hidden">
          <PanelHeader title={t("credits.ledgerTitle")} />
          <LedgerTable
            items={ledgerItems}
            isPending={ledger.isPending}
            hasNextPage={Boolean(ledger.hasNextPage)}
            onLoadMore={loadMore}
          />
        </section>
      </PageBody>
    </>
  );
}
