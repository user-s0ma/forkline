import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { getDb } from "../db/client";
import { organization } from "../db/schema";
import { yenToMicros } from "./pricing";
import { applyLedgerEntry, getWallet, updateWallet } from "./wallet";

export const TOPUP_METADATA_KIND = "credit_topup";

export function getStripe(env: CloudflareEnv) {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/** 組織の Stripe の顧客。クレジットの購入は組織単位で記録する */
export async function ensureStripeCustomer(
  env: CloudflareEnv,
  stripe: Stripe,
  organizationId: string,
  email: string,
) {
  const current = await getWallet(env, organizationId);
  if (current.stripeCustomerId) return current.stripeCustomerId;
  const [org] = await getDb(env)
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  if (!org) throw new Error("Organization not found");
  const customer = await stripe.customers.create(
    { name: org.name, email, metadata: { organizationId } },
    { idempotencyKey: `customer:org:${organizationId}` },
  );
  await updateWallet(env, organizationId, { stripeCustomerId: customer.id });
  return customer.id;
}

/** ログ用。Stripe のエラーはそのまま出すとスタックしか残らないため、理由と照会用の ID を取り出す */
export function loggableError(error: unknown) {
  if (!(error instanceof Stripe.errors.StripeError)) return error;
  return {
    type: error.type,
    code: error.code,
    param: error.param,
    message: error.message,
    requestId: error.requestId,
    statusCode: error.statusCode,
  };
}

/**
 * 出金口座が送金を受け取れるか。口座は Accounts v2 で作るが、読み取りは v1 の形で行う
 * (v2 の口座も v1 の API で読め、送金の機能は capabilities.transfers に対応する)。
 * v2 の口座には v1 の account.updated が届かないため、状態は売上の画面を開いたときの確認でも同期する
 */
export function isPayoutReady(account: Stripe.Account) {
  return Boolean(
    account.payouts_enabled && account.capabilities?.transfers === "active",
  );
}

/** 決済完了したチェックアウトを組織のクレジットに反映する。セッションIDで冪等。 */
export async function fulfillTopup(
  env: CloudflareEnv,
  session: Stripe.Checkout.Session,
) {
  if (session.metadata?.kind !== TOPUP_METADATA_KIND) return "ignored" as const;
  if (session.payment_status !== "paid") return "unpaid" as const;
  const organizationId = session.metadata.organizationId;
  const amountYen = session.amount_total ?? 0;
  if (!organizationId || amountYen <= 0) return "ignored" as const;
  return applyLedgerEntry(env, {
    organizationId,
    kind: "topup",
    balance: "credit",
    amountMicros: yenToMicros(amountYen),
    referenceId: session.id,
    description: `Credit top-up ¥${amountYen}`,
  });
}

export async function syncConnectAccount(
  env: CloudflareEnv,
  account: Stripe.Account,
) {
  const organizationId = account.metadata?.organizationId;
  if (!organizationId) return;
  await updateWallet(env, organizationId, {
    stripeConnectAccountId: account.id,
    payoutsEnabled: isPayoutReady(account),
  });
}

/* ---------------------------------------------------------------- 返金・チャージバック */

type LedgerApply = typeof applyLedgerEntry;

/** チャージの PaymentIntent に付けた組織 (チェックアウトで payment_intent_data.metadata に入れてある) */
async function topupOrganizationOf(
  stripe: Pick<Stripe, "paymentIntents">,
  source: { metadata?: Stripe.Metadata | null; payment_intent?: string | Stripe.PaymentIntent | null },
) {
  if (source.metadata?.kind === TOPUP_METADATA_KIND && source.metadata.organizationId) {
    return source.metadata.organizationId;
  }
  const intent =
    typeof source.payment_intent === "string"
      ? await stripe.paymentIntents.retrieve(source.payment_intent)
      : source.payment_intent;
  if (intent?.metadata?.kind !== TOPUP_METADATA_KIND) return null;
  return intent.metadata.organizationId || null;
}

/**
 * チャージの支払いが返金されたら、返金した額を組織のクレジットから引く (残高がマイナスになってもよい。
 * マイナスの間は呼び出しも学習もできない)。返金ごとに refund の ID で一度だけ
 */
export async function applyChargeRefunds(
  env: CloudflareEnv,
  stripe: Pick<Stripe, "paymentIntents" | "refunds">,
  charge: Stripe.Charge,
  apply: LedgerApply = applyLedgerEntry,
) {
  const organizationId = await topupOrganizationOf(stripe, charge);
  if (!organizationId) return 0;
  let applied = 0;
  for await (const refund of stripe.refunds.list({ charge: charge.id, limit: 100 })) {
    // 失敗・取り消しになった返金は引かない
    if (refund.status === "failed" || refund.status === "canceled" || refund.amount <= 0) continue;
    const result = await apply(env, {
      organizationId,
      kind: "chargeback",
      balance: "credit",
      amountMicros: -yenToMicros(refund.amount),
      referenceId: refund.id,
      description: `Refund of top-up ¥${refund.amount}`,
      allowNegative: true,
    });
    if (result === "applied") applied += 1;
  }
  return applied;
}

/** チャージバック (異議申し立て) が起きたら、その額をクレジットから引く。勝ったら戻す */
export async function applyDispute(
  env: CloudflareEnv,
  stripe: Pick<Stripe, "paymentIntents">,
  dispute: Stripe.Dispute,
  outcome: "created" | "won",
  apply: LedgerApply = applyLedgerEntry,
) {
  const organizationId = await topupOrganizationOf(stripe, dispute);
  if (!organizationId || dispute.amount <= 0) return "ignored" as const;
  const micros = yenToMicros(dispute.amount);
  return apply(env, {
    organizationId,
    kind: "chargeback",
    balance: "credit",
    amountMicros: outcome === "created" ? -micros : micros,
    referenceId: outcome === "created" ? dispute.id : `${dispute.id}:won`,
    description:
      outcome === "created"
        ? `Chargeback on top-up ¥${dispute.amount}`
        : `Chargeback won, returned ¥${dispute.amount}`,
    allowNegative: true,
  });
}

/* ---------------------------------------------------------------- 出金 */

export type TransferOutcome =
  | { state: "sent"; transferId: string }
  /** Stripe が受け付けなかったことがはっきりしている (送金されていない) */
  | { state: "failed"; error: unknown }
  /** 送金されたか分からない (つながらない・応答が無い等)。売上は戻さずに照合を待つ */
  | { state: "pending"; error: unknown };

/** 送金されていないとはっきり言えるエラー。これ以外は送金されたかもしれない */
export function isDefinitiveStripeError(error: unknown) {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError ||
    error instanceof Stripe.errors.StripeCardError ||
    error instanceof Stripe.errors.StripePermissionError ||
    error instanceof Stripe.errors.StripeAuthenticationError
  );
}

/**
 * 送金する。はっきりしない失敗は、同じ冪等キーで (Stripe が二重に送金しないので) やり直す。
 * それでも分からなければ pending を返す
 */
export async function transferWithRetry(
  create: () => Promise<{ id: string }>,
  attempts = 3,
): Promise<TransferOutcome> {
  let last: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const transfer = await create();
      return { state: "sent", transferId: transfer.id };
    } catch (error) {
      if (isDefinitiveStripeError(error)) return { state: "failed", error };
      last = error;
    }
  }
  return { state: "pending", error: last };
}

/* ---------------------------------------------------------------- 売上の保留 */

/** 売上を出金できるようになるまでの日数 (環境変数 EARNINGS_HOLD_DAYS で変えられる) */
export const DEFAULT_EARNINGS_HOLD_DAYS = 7;

export function earningsHoldDays(env: { EARNINGS_HOLD_DAYS?: string }) {
  const value = Number.parseInt(env.EARNINGS_HOLD_DAYS ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_EARNINGS_HOLD_DAYS;
}

/**
 * 売上の残高を、出金できる分と保留中の分に分ける。保留中は直近 holdDays 日に計上した売上
 * (チャージの返金・チャージバックに備え、すぐには出金させない)
 */
export function splitEarnings(earningsMicros: number, recentMicros: number) {
  const pending = Math.min(Math.max(0, earningsMicros), Math.max(0, recentMicros));
  return { availableMicros: Math.max(0, earningsMicros - pending), pendingMicros: pending };
}
