import assert from "node:assert/strict";
import test from "node:test";
import { MIN_BALANCE_MICROS } from "../src/lib/billing/pricing";
import { holdDifference, sumHeld } from "../src/lib/billing/wallet";
import { holdMicrosFor, isFree, type Invocation } from "../src/workers/gateway/runtime";

function invocation(overrides: {
  organizationId: string;
  prices?: Partial<Invocation["model"]>;
}) {
  return {
    consumerOrganizationId: "consumer",
    model: {
      organizationId: overrides.organizationId,
      priceInputMicros: 0,
      priceOutputMicros: 0,
      pricePerRequestMicros: 0,
      ...overrides.prices,
    },
  } as unknown as Invocation;
}

test("自組織のモデルとクリエイター価格の無いモデルは、呼び出しごとの料金が掛からない", () => {
  assert.equal(isFree(invocation({ organizationId: "consumer", prices: { priceOutputMicros: 5 } })), true);
  assert.equal(isFree(invocation({ organizationId: "publisher" })), true);
  assert.equal(
    isFree(invocation({ organizationId: "publisher", prices: { pricePerRequestMicros: 1 } })),
    false,
  );
});

test("仮押さえは1回あたりの料金と、入出力のトークンの上限を合わせた額 (下限あり)", () => {
  const bounds = { inputTokens: 4_000, outputTokens: 4_000 };
  assert.equal(
    holdMicrosFor(
      invocation({
        organizationId: "publisher",
        prices: { pricePerRequestMicros: 5_000_000, priceOutputMicros: 1_000_000_000 },
      }),
      bounds,
    ),
    5_000_000 + 4_000_000,
  );
  assert.equal(
    holdMicrosFor(invocation({ organizationId: "publisher", prices: { priceInputMicros: 1 } }), bounds),
    MIN_BALANCE_MICROS,
  );
});

test("精算では仮押さえと実際の料金の差だけ残高を動かす", () => {
  assert.equal(holdDifference(1_000, 400), 600);
  assert.equal(holdDifference(1_000, 1_500), -500);
  assert.equal(holdDifference(0, 300), -300);
  assert.equal(holdDifference(-5, 0), 0);
});

test("押さえ中の額は負の値を数えない", () => {
  assert.equal(sumHeld([{ heldMicros: 100 }, { heldMicros: 0 }, { heldMicros: -3 }]), 100);
});
