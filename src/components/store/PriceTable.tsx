import { useTranslation } from "react-i18next";
import type { StorePricing } from "@/lib/api-client";
import { localeTag, useLocale } from "@/lib/i18n";
import { formatYen } from "@/lib/billing/pricing";
import { priceRows } from "./price";
import { usePriceLabel } from "./price-label";

export function PriceTable({ pricing }: { pricing: StorePricing }) {
  const { t } = useTranslation();
  const describe = usePriceLabel();
  const rows = priceRows(pricing);

  return (
    <div>
      {rows.length === 0 ? (
        <p className="text-2xl font-semibold">{t("store.pricing.free")}</p>
      ) : (
        <dl className="divide-y divide-line">
          {rows.map((row) => {
            const { label, unit, price } = describe(row);
            return (
              <div
                key={row.key}
                className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0"
              >
                <dt className="text-sm text-ink-soft">
                  {label && <span className="mr-1 text-ink">{label}</span>}
                  {unit}
                </dt>
                <dd className="num text-base font-semibold text-ink">
                  {price}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {rows.length > 0 && (
        <p className="mt-3 text-xs leading-5 text-ink-mute">
          {t("store.pricing.noCompute")}
        </p>
      )}
    </div>
  );
}

/** 実際に実行したときの1回あたりの平均 (料金表だけでは GPU の時間などが読めないため) */
export function RecentCost({ averageMicros }: { averageMicros: number }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-line pt-3">
      <dt className="text-sm text-ink-soft">
        <span className="mr-1 text-ink">{t("store.pricing.recentAverage")}</span>
        {t("store.pricing.perRequest")}
      </dt>
      <dd className="num text-base font-semibold text-ink">
        {formatYen(averageMicros, localeTag(locale))}
      </dd>
    </div>
  );
}
