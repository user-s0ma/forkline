import { Receipt } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/EmptyState";
import { InfiniteScrollSentinel } from "@/components/ui/InfiniteScrollSentinel";
import { ListSkeleton } from "@/components/ui/ListSkeleton";
import type { LedgerRecord } from "@/lib/api-client";
import { useDateFormatter, useYen } from "./hooks";

export function LedgerTable({
  items,
  isPending,
  hasNextPage,
  onLoadMore,
  emptyDescription,
}: {
  items: LedgerRecord[];
  isPending: boolean;
  hasNextPage: boolean;
  onLoadMore: () => void;
  emptyDescription?: string;
}) {
  const { t } = useTranslation();
  const yen = useYen();
  const dateFormatter = useDateFormatter();

  if (isPending) return <ListSkeleton rows={3} />;
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        icon={Receipt}
        title={t("credits.ledgerEmpty")}
        description={emptyDescription}
      />
    );
  }
  return (
    <div>
      <table className="console-table table-fixed">
        <thead>
          <tr>
            <th className="w-28 sm:w-44">{t("credits.ledger.date")}</th>
            <th>{t("credits.ledger.description")}</th>
            <th className="hidden w-28 sm:table-cell">
              {t("credits.ledger.balance")}
            </th>
            <th className="w-24 text-right sm:w-32">{t("credits.ledger.amount")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td className="num text-ink-mute">
                {dateFormatter.format(new Date(item.createdAt))}
              </td>
              <td className="min-w-0">
                <p className="truncate text-ink">
                  {t(`credits.kinds.${item.kind}`)}
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-mute">
                  {item.description}
                </p>
              </td>
              <td className="hidden text-ink-mute sm:table-cell">
                {t(`credits.balances.${item.balance}`)}
              </td>
              <td
                className={`num text-right font-medium ${
                  item.amountMicros > 0 ? "text-earn" : "text-ink"
                }`}
              >
                {item.amountMicros > 0 ? "+" : ""}
                {yen(item.amountMicros)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasNextPage && (
        <InfiniteScrollSentinel onLoadMore={onLoadMore} rows={2} />
      )}
    </div>
  );
}
