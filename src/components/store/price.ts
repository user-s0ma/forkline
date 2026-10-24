import type { StorePricing } from "@/lib/api-client";

export type PriceRow = {
  key: "input" | "output" | "perRequest";
  micros: number;
};

/** 利用者が払う単価 (クリエイター価格) の行。0 の行は含めない。 */
export function priceRows(pricing: StorePricing): PriceRow[] {
  const rows: PriceRow[] = [
    { key: "input", micros: pricing.priceInputMicros },
    { key: "output", micros: pricing.priceOutputMicros },
    { key: "perRequest", micros: pricing.pricePerRequestMicros },
  ];
  return rows.filter((row) => row.micros > 0);
}

/** カードに出す代表価格。出力トークン単価 > リクエスト単価 > 入力トークン単価 の順で選ぶ。 */
export function headlinePrice(pricing: StorePricing): PriceRow | null {
  const rows = priceRows(pricing);
  return (
    rows.find((row) => row.key === "output") ??
    rows.find((row) => row.key === "perRequest") ??
    rows[0] ??
    null
  );
}
