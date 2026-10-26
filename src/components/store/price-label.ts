import { useTranslation } from "react-i18next";
import { LOCALE_TAG } from "@/lib/i18n";
import { formatYen } from "@/lib/billing/pricing";
import type { PriceRow } from "./price";

export function usePriceLabel() {
  const { t } = useTranslation();
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
    price: formatYen(row.micros, LOCALE_TAG),
  });
}
