import { useTranslation } from "react-i18next";
import { localeTag, useLocale } from "@/lib/i18n";
import { formatYen } from "@/lib/billing/pricing";
import type { PriceRow } from "./price";

export function usePriceLabel() {
  const { t } = useTranslation();
  const locale = useLocale();
  return (row: PriceRow) => ({
    label:
      row.key === "input"
        ? t("store.pricing.input")
        : row.key === "output"
          ? t("store.pricing.output")
          : null,
    unit:
      row.key === "perRequest"
        ? t("store.pricing.perRequest")
        : t("store.pricing.perMillion"),
    price: formatYen(row.micros, localeTag(locale)),
  });
}
