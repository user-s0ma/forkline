// 金額は全て「マイクロ円」(1円 = 1,000,000) の整数で扱う。
// トークン単価のような1円未満の値を丸め誤差なく積み上げるため。
export const MICROS_PER_YEN = 1_000_000;
export const CURRENCY = "jpy";

/** クリエイター売上に対するプラットフォーム手数料 (basis points)。 */
export const PLATFORM_FEE_BPS = 2000;

export const TOPUP_MIN_YEN = 500;
export const TOPUP_MAX_YEN = 100_000;
export const PAYOUT_MIN_YEN = 1_000;
/** 呼び出し前に最低限必要なクレジット残高。 */
export const MIN_BALANCE_MICROS = 1 * MICROS_PER_YEN;

/** 用途ではなく入出力の種類で分ける (チャット・要約・翻訳・コード生成はすべて text)。 */
export const MODEL_CATEGORIES = [
  "text",
  "code",
  "vision",
  "other",
] as const;
export type ModelCategory = (typeof MODEL_CATEGORIES)[number];

export function yenToMicros(yen: number) {
  return Math.round(yen * MICROS_PER_YEN);
}

export function microsToYen(micros: number) {
  return micros / MICROS_PER_YEN;
}

export type ModelPrice = {
  /** 入力 100万トークンあたりのクリエイター価格 (マイクロ円)。 */
  priceInputMicros: number;
  /** 出力 100万トークンあたりのクリエイター価格 (マイクロ円)。 */
  priceOutputMicros: number;
  /** 1リクエストあたりのクリエイター価格 (マイクロ円)。 */
  pricePerRequestMicros: number;
};

export type UsageCharge = {
  totalMicros: number;
  computeMicros: number;
  creatorMicros: number;
  platformFeeMicros: number;
};

/**
 * 1回の呼び出しの請求額を内訳付きで計算する。
 * 自組織のモデルを使う場合 (selfUse) はクリエイター価格を取らず原価のみ。
 * Nebius のエンドポイントの GPU 代は呼び出しごとではなく、動いていた時間で公開した組織に請求する
 * (src/lib/billing/compute.ts)。ここでの computeMicros は呼び出しごとの原価があるときだけ使う。
 */
export function quoteUsage(
  price: ModelPrice,
  usage: { inputTokens: number; outputTokens: number; computeMicros: number },
  options: { selfUse?: boolean } = {},
): UsageCharge {
  const computeMicros = Math.max(0, Math.ceil(usage.computeMicros));
  const gross = options.selfUse
    ? 0
    : Math.ceil(
        price.pricePerRequestMicros +
          (Math.max(0, usage.inputTokens) * price.priceInputMicros) /
            1_000_000 +
          (Math.max(0, usage.outputTokens) * price.priceOutputMicros) /
            1_000_000,
      );
  const platformFeeMicros = Math.ceil((gross * PLATFORM_FEE_BPS) / 10_000);
  return {
    totalMicros: computeMicros + gross,
    computeMicros,
    creatorMicros: gross - platformFeeMicros,
    platformFeeMicros,
  };
}

/**
 * 請求額を上限 (仮押さえした額) までに抑える。原価を先に取り、残りをクリエイター価格として手数料と分け直す。
 */
export function capCharge(charge: UsageCharge, capMicros: number): UsageCharge {
  const cap = Math.max(0, Math.floor(capMicros));
  if (charge.totalMicros <= cap) return charge;
  const computeMicros = Math.min(charge.computeMicros, cap);
  const gross = cap - computeMicros;
  const platformFeeMicros = Math.ceil((gross * PLATFORM_FEE_BPS) / 10_000);
  return {
    totalMicros: cap,
    computeMicros,
    creatorMicros: gross - platformFeeMicros,
    platformFeeMicros,
  };
}

export function formatYen(micros: number, locale = "ja-JP") {
  const yen = microsToYen(micros);
  const digits =
    Math.abs(yen) > 0 && Math.abs(yen) < 1 ? 4 : Math.abs(yen) < 100 ? 2 : 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "JPY",
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(yen);
}

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/;

export function toModelSlug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
