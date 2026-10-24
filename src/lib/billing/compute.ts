import { MICROS_PER_YEN } from "./pricing";

/*
 * Nebius の GPU 代の設定。料金の計算に使う数字はここにまとめる。
 *
 * GPU の時間単価 (USD) は、Nemotron ごとに src/lib/nebius/models.ts の trainUsdPerHour / serveUsdPerHour にある
 * (Nebius の価格表の日付つき)。ここでは、それを円に換算して上乗せする割合と、学習時間の見積もりの数字を持つ。
 * 公開前に必ず Nebius の現在の価格 (https://nebius.com/prices) と、下の数字を照らし合わせること。
 */

/** USD 建ての原価を円に換算するレート。要確認: 公開前に現在のレートに合わせる */
export const USD_JPY = 150;

/**
 * 原価に上乗せする割合 (basis points)。起動・停止の待ち時間、見積もりと実際の差、為替の動きを吸収する。
 * 2000 = 20%
 */
export const COMPUTE_MARKUP_BPS = 2000;

/** Nemotron の一覧から時間単価が分からないときに使う (安く見積もらないよう、一覧で一番高い H200 の学習に合わせる) */
export const FALLBACK_USD_PER_HOUR = 5.4;

/** GPU の時間単価 (USD) を、上乗せ込みの1時間あたりのマイクロ円にする */
export function microsPerHour(usdPerHour: number | null | undefined) {
  const usd = usdPerHour && usdPerHour > 0 ? usdPerHour : FALLBACK_USD_PER_HOUR;
  return Math.ceil(usd * USD_JPY * MICROS_PER_YEN * (1 + COMPUTE_MARKUP_BPS / 10_000));
}

/** 1時間あたり rate (マイクロ円) の GPU を seconds 秒使った料金 (切り上げ) */
export function computeCostMicros(rateMicrosPerHour: number, seconds: number) {
  return Math.ceil((Math.max(0, rateMicrosPerHour) * Math.max(0, seconds)) / 3600);
}

/* ---------------------------------------------------------------- 学習 */

/**
 * 学習時間の見積もりに使う数字。要確認: 実際の学習の記録 (forkline-result.json の duration) と照らして直す。
 * - 起動・イメージの取得・モデルの読み込み・LoRA の書き出しにかかる固定の時間
 * - 1秒あたりに学習できるトークン数 (Nemotron Nano クラスを GPU 1枚で LoRA 学習した場合の控えめな目安)
 * - 1トークンあたりのバイト数 (JSON の記号も含めた chat 形式の JSONL の目安)
 */
export const TRAIN_OVERHEAD_SECONDS = 15 * 60;
export const TRAIN_TOKENS_PER_SECOND = 2_000;
export const TRAIN_BYTES_PER_TOKEN = 4;
/** 見積もりの何倍を仮押さえするか (見積もりより長くかかっても残高がマイナスになりにくいように) */
export const TRAIN_HOLD_MULTIPLIER = 1.5;
/** これより長くかかった学習は止める (Nebius 側の打ち切りと同じ6時間) */
export const TRAIN_MAX_SECONDS = 6 * 60 * 60;

export function estimateTrainingSeconds(input: {
  datasetBytes: number;
  epochs: number;
}) {
  const tokens = Math.ceil(Math.max(0, input.datasetBytes) / TRAIN_BYTES_PER_TOKEN);
  return Math.ceil(
    TRAIN_OVERHEAD_SECONDS +
      (tokens * Math.max(1, input.epochs)) / TRAIN_TOKENS_PER_SECOND,
  );
}

export function estimateTrainingMicros(input: {
  trainMicrosPerHour: number;
  datasetBytes: number;
  epochs: number;
}) {
  return computeCostMicros(input.trainMicrosPerHour, estimateTrainingSeconds(input));
}

export function trainingHoldMicros(estimatedMicros: number) {
  return Math.ceil(estimatedMicros * TRAIN_HOLD_MULTIPLIER);
}

/* ---------------------------------------------------------------- 推論のエンドポイント */

/** 呼ばれないまま、この分数が過ぎたエンドポイントは止める (環境変数 ENDPOINT_IDLE_MINUTES で変えられる) */
export const DEFAULT_ENDPOINT_IDLE_MINUTES = 15;

export function endpointIdleMinutes(env: { ENDPOINT_IDLE_MINUTES?: string }) {
  const value = Number.parseInt(env.ENDPOINT_IDLE_MINUTES ?? "", 10);
  return Number.isFinite(value) && value >= 1 ? value : DEFAULT_ENDPOINT_IDLE_MINUTES;
}

/** 起動にかかる時間の目安。起動したら最低でも (起動 + 待ち時間) は動くので、その分を仮押さえする */
export const ENDPOINT_BOOT_SECONDS = 10 * 60;

export function endpointHoldMicros(rateMicrosPerHour: number, idleMinutes: number) {
  return computeCostMicros(rateMicrosPerHour, ENDPOINT_BOOT_SECONDS + idleMinutes * 60);
}

/** 呼び出しが来たのに止まっていた (起動中だった) ときに、もう一度呼んでほしい秒数 (Retry-After) */
export const ENDPOINT_RETRY_AFTER_SECONDS = 30;

/* ---------------------------------------------------------------- Token Factory の Nemotron */

/*
 * 学習データ作り・評価・モデルカードの下書きで呼ぶ Token Factory の Nemotron の料金。
 * 組織のクレジットから、使ったトークン数 × 単価 (上乗せ込み) を引く。
 * 要確認: Token Factory の価格表 (https://tokenfactory.nebius.com/) で、
 * DEFAULT_TOKEN_FACTORY_MODEL の 100万トークンあたりの USD と照らし合わせること。
 */
export const TOKEN_FACTORY_USD_PER_M_INPUT = 0.2;
export const TOKEN_FACTORY_USD_PER_M_OUTPUT = 0.8;

/** 入力と出力のトークン数から、上乗せ込みの料金 (マイクロ円、切り上げ) */
export function tokenFactoryCostMicros(usage: { inputTokens: number; outputTokens: number }) {
  const usd =
    (Math.max(0, usage.inputTokens) * TOKEN_FACTORY_USD_PER_M_INPUT +
      Math.max(0, usage.outputTokens) * TOKEN_FACTORY_USD_PER_M_OUTPUT) /
    1_000_000;
  return Math.ceil(usd * USD_JPY * MICROS_PER_YEN * (1 + COMPUTE_MARKUP_BPS / 10_000));
}

/**
 * 呼ぶ前に仮押さえする額。入力は文字数をそのままトークン数とみなし (日本語でも多めになる)、
 * 出力は maxTokens いっぱいまで使ったとして見積もる。
 */
export function tokenFactoryHoldMicros(input: { inputChars: number; maxTokens: number }) {
  return tokenFactoryCostMicros({
    inputTokens: Math.ceil(Math.max(0, input.inputChars)),
    outputTokens: Math.max(0, input.maxTokens),
  });
}
