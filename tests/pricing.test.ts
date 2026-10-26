import assert from "node:assert/strict";
import test from "node:test";
import {
  MICROS_PER_YEN,
  PLATFORM_FEE_BPS,
  quoteUsage,
  SLUG_PATTERN,
  toModelSlug,
  yenToMicros,
} from "../src/lib/billing/pricing";
import {
  COMPUTE_MARKUP_BPS,
  computeCostMicros,
  endpointHoldMicros,
  endpointIdleMinutes,
  ENDPOINT_BOOT_SECONDS,
  estimateTrainingMicros,
  estimateTrainingSeconds,
  FALLBACK_USD_PER_HOUR,
  microsPerHour,
  TRAIN_BYTES_PER_TOKEN,
  TRAIN_OVERHEAD_SECONDS,
  TRAIN_TOKENS_PER_SECOND,
  trainingHoldMicros,
  USD_JPY,
} from "../src/lib/billing/compute";

const PRICE = {
  priceInputMicros: yenToMicros(100),
  priceOutputMicros: yenToMicros(300),
  pricePerRequestMicros: yenToMicros(1),
};

test("クリエイター価格は1リクエスト+トークン従量で積み上がる", () => {
  const charge = quoteUsage(PRICE, {
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    computeMicros: 0,
  });
  const gross = yenToMicros(1 + 100 + 150);
  assert.equal(charge.totalMicros, gross);
  assert.equal(charge.platformFeeMicros, (gross * PLATFORM_FEE_BPS) / 10_000);
  assert.equal(charge.creatorMicros, gross - charge.platformFeeMicros);
  assert.equal(charge.computeMicros, 0);
});

test("原価はクリエイター取り分に含めず利用者の合計にだけ足す", () => {
  const charge = quoteUsage(PRICE, { inputTokens: 0, outputTokens: 0, computeMicros: 12_345 });
  assert.equal(charge.totalMicros, yenToMicros(1) + 12_345);
  assert.equal(charge.creatorMicros + charge.platformFeeMicros, yenToMicros(1));
});

test("自分のモデルはクリエイター価格を請求しない", () => {
  const charge = quoteUsage(
    PRICE,
    { inputTokens: 1000, outputTokens: 1000, computeMicros: 500 },
    { selfUse: true },
  );
  assert.deepEqual(charge, {
    totalMicros: 500,
    computeMicros: 500,
    creatorMicros: 0,
    platformFeeMicros: 0,
  });
});

test("端数は切り上げ、内訳の合計は常に一致する", () => {
  for (const tokens of [1, 7, 333, 12_345]) {
    const charge = quoteUsage(
      { priceInputMicros: 3, priceOutputMicros: 7, pricePerRequestMicros: 0 },
      { inputTokens: tokens, outputTokens: tokens, computeMicros: 0.4 },
    );
    assert.ok(Number.isInteger(charge.totalMicros));
    assert.equal(
      charge.totalMicros,
      charge.computeMicros + charge.creatorMicros + charge.platformFeeMicros,
    );
  }
});

test("負のトークン数は0として扱う", () => {
  const charge = quoteUsage(PRICE, { inputTokens: -10, outputTokens: -10, computeMicros: -5 });
  assert.equal(charge.totalMicros, yenToMicros(1));
});

test("GPU の時間単価は USD × 為替 × 上乗せ、分からなければ高めの既定", () => {
  const expected = Math.ceil(1.55 * USD_JPY * MICROS_PER_YEN * (1 + COMPUTE_MARKUP_BPS / 10_000));
  assert.equal(microsPerHour(1.55), expected);
  assert.equal(microsPerHour(undefined), microsPerHour(FALLBACK_USD_PER_HOUR));
  assert.equal(microsPerHour(0), microsPerHour(FALLBACK_USD_PER_HOUR));
});

test("GPU の料金は秒単位で切り上げ、負の時間は0", () => {
  const rate = microsPerHour(1.75);
  assert.equal(computeCostMicros(rate, 3600), rate);
  assert.equal(computeCostMicros(rate, 1), Math.ceil(rate / 3600));
  assert.equal(computeCostMicros(rate, -10), 0);
});

test("学習時間は固定の時間 + トークン数 × エポック ÷ 速さで見積もる", () => {
  const bytes = 4_000_000;
  const seconds = estimateTrainingSeconds({ datasetBytes: bytes, epochs: 3 });
  assert.equal(
    seconds,
    Math.ceil(
      TRAIN_OVERHEAD_SECONDS + ((bytes / TRAIN_BYTES_PER_TOKEN) * 3) / TRAIN_TOKENS_PER_SECOND,
    ),
  );
  const rate = microsPerHour(1.75);
  const estimate = estimateTrainingMicros({ trainMicrosPerHour: rate, datasetBytes: bytes, epochs: 3 });
  assert.equal(estimate, computeCostMicros(rate, seconds));
  assert.equal(trainingHoldMicros(estimate), Math.ceil(estimate * 1.5));
});

test("エンドポイントの仮押さえは起動と待ち時間の分", () => {
  const rate = microsPerHour(1.55);
  assert.equal(endpointHoldMicros(rate, 15), computeCostMicros(rate, ENDPOINT_BOOT_SECONDS + 900));
  assert.equal(endpointIdleMinutes({ ENDPOINT_IDLE_MINUTES: "5" }), 5);
  assert.equal(endpointIdleMinutes({ ENDPOINT_IDLE_MINUTES: "" }), 15);
  assert.equal(endpointIdleMinutes({ ENDPOINT_IDLE_MINUTES: "0" }), 15);
});

test("モデル名からAPIで使えるslugを作る", () => {
  assert.equal(toModelSlug("My Cool Model v2!"), "my-cool-model-v2");
  assert.ok(SLUG_PATTERN.test("my-cool-model-v2"));
  assert.ok(!SLUG_PATTERN.test("-bad"));
  assert.ok(!SLUG_PATTERN.test("Bad"));
  assert.ok(!SLUG_PATTERN.test("ab"));
});
