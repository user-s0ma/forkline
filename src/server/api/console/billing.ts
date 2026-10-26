import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { encodeCursor } from "@/lib/util/cursor";
import { getDb } from "@/lib/db/client";
import { aiModel, fineTune, ledgerEntry, usageRecord } from "@/lib/db/schema";
import { detectLocale, translate } from "@/lib/i18n";
import {
  CURRENCY,
  microsToYen,
  PAYOUT_MIN_YEN,
  TOPUP_MAX_YEN,
  TOPUP_MIN_YEN,
  yenToMicros,
} from "@/lib/billing/pricing";
import {
  earningsHoldDays,
  ensureStripeCustomer,
  getStripe,
  isPayoutReady,
  loggableError,
  splitEarnings,
  TOPUP_METADATA_KIND,
  transferWithRetry,
} from "@/lib/billing/stripe";
import {
  applyLedgerEntry,
  getWallet,
  sumHeld,
  updateWallet,
} from "@/lib/billing/wallet";
import { ACTIVE_FINE_TUNE_STATUSES } from "@/lib/compute/fine-tune";
import { LIVE_ENDPOINT_STATUSES } from "@/lib/compute/endpoint";
import { currentUser, requireUser } from "./session";
import {
  cursorCondition,
  message,
  pageSizeOf,
} from "./shared";
import type { ApiEnv } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

const topupSchema = z.object({
  amountYen: z.number().int().min(TOPUP_MIN_YEN).max(TOPUP_MAX_YEN),
});
const payoutSchema = z.object({ amountYen: z.number().int().min(PAYOUT_MIN_YEN) });
const connectSchema = z.object({ country: z.enum(["JP", "US"]).default("JP") });

const billing = new Hono<ApiEnv>();

for (const path of ["wallet", "wallet/*", "usage", "usage/*", "earnings/*", "payouts", "payouts/*"]) {
  billing.use(`/${path}`, requireUser());
}

function consolePath(c: { req: { url: string } }, page: string) {
  return `${new URL(c.req.url).origin}/app/${page}`;
}

/** 学習とエンドポイントのために仮押さえしている額 */
async function heldMicros(env: AppEnv, userId: string) {
  const db = getDb(env);
  const [jobs, endpoints] = await Promise.all([
    db
      .select({ heldMicros: fineTune.heldMicros })
      .from(fineTune)
      .where(
        and(
          eq(fineTune.userId, userId),
          inArray(fineTune.status, [...ACTIVE_FINE_TUNE_STATUSES]),
        ),
      ),
    db
      .select({ heldMicros: aiModel.endpointHeldMicros })
      .from(aiModel)
      .where(
        and(
          eq(aiModel.userId, userId),
          inArray(aiModel.endpointStatus, [...LIVE_ENDPOINT_STATUSES, "deploying"]),
        ),
      ),
  ]);
  return sumHeld(jobs) + sumHeld(endpoints);
}

/** 保留中の売上: 直近 EARNINGS_HOLD_DAYS 日に計上した売上 */
async function recentEarningsMicros(env: AppEnv, userId: string) {
  const days = earningsHoldDays(env);
  if (days <= 0) return 0;
  const since = new Date(Date.now() - days * DAY_MS);
  const [row] = await getDb(env)
    .select({ micros: sql<string>`coalesce(sum(${usageRecord.creatorMicros}), 0)` })
    .from(usageRecord)
    .where(
      and(
        eq(usageRecord.publisherUserId, userId),
        gte(usageRecord.createdAt, since),
      ),
    );
  return Number(row?.micros ?? 0);
}

billing.get("/wallet", async (c) => {
  const userId = currentUser(c).id;
  let record = await getWallet(c.env, userId);
  if (record.stripeConnectAccountId && !record.payoutsEnabled) {
    try {
      const account = await getStripe(c.env).accounts.retrieve(
        record.stripeConnectAccountId,
      );
      if (isPayoutReady(account)) {
        await updateWallet(c.env, userId, { payoutsEnabled: true });
        record = { ...record, payoutsEnabled: true };
      }
    } catch (error) {
      console.error("Stripe Connect の口座を確認できませんでした:", loggableError(error));
    }
  }
  const earnings = splitEarnings(
    record.earningsMicros,
    await recentEarningsMicros(c.env, userId),
  );
  return c.json({
    creditMicros: record.creditMicros,
    heldMicros: await heldMicros(c.env, userId),
    earningsMicros: record.earningsMicros,
    availableEarningsMicros: earnings.availableMicros,
    pendingEarningsMicros: earnings.pendingMicros,
    earningsHoldDays: earningsHoldDays(c.env),
    connectAccountId: record.stripeConnectAccountId,
    payoutsEnabled: record.payoutsEnabled,
    limits: {
      topupMinYen: TOPUP_MIN_YEN,
      topupMaxYen: TOPUP_MAX_YEN,
      payoutMinYen: PAYOUT_MIN_YEN,
    },
  });
});

billing.get("/wallet/ledger", async (c) => {
  const userId = currentUser(c).id;
  const pageSize = pageSizeOf(c.req.query("pageSize"));
  const conditions = [eq(ledgerEntry.userId, userId)];
  const balance = c.req.query("balance");
  if (balance === "credit" || balance === "earnings") {
    conditions.push(eq(ledgerEntry.balance, balance));
  }
  const boundary = cursorCondition(c.req.query("cursor"), ledgerEntry.createdAt, ledgerEntry.id);
  if (boundary) conditions.push(boundary);
  const rows = await getDb(c.env)
    .select()
    .from(ledgerEntry)
    .where(and(...conditions))
    .orderBy(desc(ledgerEntry.createdAt), desc(ledgerEntry.id))
    .limit(pageSize + 1);
  const page = rows.slice(0, pageSize);
  const last = page.at(-1);
  return c.json({
    items: page.map((row) => ({
      id: row.id,
      kind: row.kind,
      balance: row.balance,
      amountMicros: row.amountMicros,
      description: row.description,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor:
      rows.length > pageSize && last ? encodeCursor(last.createdAt, last.id) : null,
  });
});

billing.post("/wallet/topup", async (c) => {
  const userId = currentUser(c).id;
  const locale = detectLocale(c.req.raw);
  const input = topupSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) {
    return c.json(
      message(c, "server.billing.invalidTopup", { min: TOPUP_MIN_YEN, max: TOPUP_MAX_YEN }),
      400,
    );
  }
  const stripe = getStripe(c.env);
  const customer = await ensureStripeCustomer(c.env, stripe, currentUser(c));
  const base = consolePath(c, "billing");
  const metadata = { kind: TOPUP_METADATA_KIND, userId };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: input.data.amountYen,
          product_data: { name: translate(locale, "server.billing.topupProduct") },
        },
      },
    ],
    metadata,
    payment_intent_data: { metadata },
    success_url: `${base}?topup=success`,
    cancel_url: `${base}?topup=cancel`,
  });
  return c.json({ url: session.url });
});

/** 自分が呼び出した記録 (支出の側) */
billing.get("/usage", async (c) => {
  const userId = currentUser(c).id;
  const pageSize = pageSizeOf(c.req.query("pageSize"));
  const conditions = [eq(usageRecord.consumerUserId, userId)];
  const boundary = cursorCondition(c.req.query("cursor"), usageRecord.createdAt, usageRecord.id);
  if (boundary) conditions.push(boundary);
  const rows = await getDb(c.env)
    .select()
    .from(usageRecord)
    .where(and(...conditions))
    .orderBy(desc(usageRecord.createdAt), desc(usageRecord.id))
    .limit(pageSize + 1);
  const page = rows.slice(0, pageSize);
  const last = page.at(-1);
  return c.json({
    items: page.map((row) => ({
      id: row.id,
      modelSlug: row.modelSlug,
      source: row.source,
      status: row.status,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      latencyMs: row.latencyMs,
      totalMicros: row.totalMicros,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor:
      rows.length > pageSize && last ? encodeCursor(last.createdAt, last.id) : null,
  });
});

async function dailySeries(
  env: AppEnv,
  side: "consumer" | "publisher",
  userId: string,
) {
  const column =
    side === "consumer"
      ? usageRecord.consumerUserId
      : usageRecord.publisherUserId;
  const amount = side === "consumer" ? usageRecord.totalMicros : usageRecord.creatorMicros;
  const since = new Date(Date.now() - 30 * DAY_MS);
  const rows = await getDb(env)
    .select({
      day: sql<string>`date_format(${usageRecord.createdAt}, '%Y-%m-%d')`,
      requests: sql<string>`count(*)`,
      micros: sql<string>`coalesce(sum(${amount}), 0)`,
    })
    .from(usageRecord)
    .where(and(eq(column, userId), gte(usageRecord.createdAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((row) => ({
    day: row.day,
    requests: Number(row.requests),
    micros: Number(row.micros),
  }));
}

billing.get("/usage/summary", async (c) => {
  const userId = currentUser(c).id;
  const since = new Date(Date.now() - 30 * DAY_MS);
  const [days, byModel] = await Promise.all([
    dailySeries(c.env, "consumer", userId),
    getDb(c.env)
      .select({
        modelSlug: usageRecord.modelSlug,
        requests: sql<string>`count(*)`,
        micros: sql<string>`coalesce(sum(${usageRecord.totalMicros}), 0)`,
      })
      .from(usageRecord)
      .where(
        and(
          eq(usageRecord.consumerUserId, userId),
          gte(usageRecord.createdAt, since),
        ),
      )
      .groupBy(usageRecord.modelSlug)
      .orderBy(desc(sql`3`))
      .limit(10),
  ]);
  return c.json({
    days,
    byModel: byModel.map((row) => ({
      modelSlug: row.modelSlug,
      requests: Number(row.requests),
      micros: Number(row.micros),
    })),
  });
});

/** 自分のモデルが呼ばれた記録 (売上の側) */
billing.get("/earnings/summary", async (c) => {
  const userId = currentUser(c).id;
  const since = new Date(Date.now() - 30 * DAY_MS);
  const [days, byModel] = await Promise.all([
    dailySeries(c.env, "publisher", userId),
    getDb(c.env)
      .select({
        modelId: usageRecord.modelId,
        modelSlug: usageRecord.modelSlug,
        name: aiModel.name,
        requests: sql<string>`count(*)`,
        micros: sql<string>`coalesce(sum(${usageRecord.creatorMicros}), 0)`,
      })
      .from(usageRecord)
      .leftJoin(aiModel, eq(aiModel.id, usageRecord.modelId))
      .where(
        and(
          eq(usageRecord.publisherUserId, userId),
          gte(usageRecord.createdAt, since),
        ),
      )
      .groupBy(usageRecord.modelId, usageRecord.modelSlug, aiModel.name)
      .orderBy(desc(sql`5`))
      .limit(10),
  ]);
  return c.json({
    days,
    byModel: byModel.map((row) => ({
      modelId: row.modelId,
      modelSlug: row.modelSlug,
      name: row.name ?? row.modelSlug,
      requests: Number(row.requests),
      micros: Number(row.micros),
    })),
  });
});

billing.post("/payouts/connect", async (c) => {
  const userId = currentUser(c).id;
  const input = connectSchema.safeParse(await c.req.json().catch(() => ({})));
  const stripe = getStripe(c.env);
  let { stripeConnectAccountId: accountId } = await getWallet(c.env, userId);
  if (!accountId) {
    // 本番では、プラットフォームが損失を負う口座は Accounts v2 でしか作れない。
    // 支払いはプラットフォームが受けて送金する方式 (支払いと送金の分離) なので、
    // 口座は送金を受け取る (recipient) 設定にし、手数料と損失の責任はプラットフォーム側にする。
    // 日本などでは送金の受け取りにカード決済の機能 (merchant) も必要なため、あわせて要求する
    const account = await stripe.v2.core.accounts.create(
      {
        contact_email: currentUser(c).email,
        dashboard: "express",
        identity: { country: input.success ? input.data.country : "JP" },
        defaults: {
          currency: CURRENCY,
          responsibilities: {
            fees_collector: "application",
            losses_collector: "application",
          },
        },
        configuration: {
          merchant: { capabilities: { card_payments: { requested: true } } },
          recipient: {
            capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
          },
        },
        metadata: { userId },
      },
      { idempotencyKey: `connect:v2:user:${userId}` },
    );
    accountId = account.id;
    await updateWallet(c.env, userId, {
      stripeConnectAccountId: accountId,
      payoutsEnabled: false,
    });
  }
  const base = consolePath(c, "earnings");
  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["merchant", "recipient"],
        refresh_url: `${base}?connect=refresh`,
        return_url: `${base}?connect=return`,
      },
    },
  });
  return c.json({ url: link.url });
});

billing.post("/payouts/dashboard", async (c) => {
  const { stripeConnectAccountId } = await getWallet(c.env, currentUser(c).id);
  if (!stripeConnectAccountId) {
    return c.json(message(c, "server.billing.connectRequired"), 400);
  }
  const link = await getStripe(c.env).accounts.createLoginLink(stripeConnectAccountId);
  return c.json({ url: link.url });
});

billing.post("/payouts", async (c) => {
  const userId = currentUser(c).id;
  const input = payoutSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) {
    return c.json(message(c, "server.billing.payoutMinimum", { min: PAYOUT_MIN_YEN }), 400);
  }
  const record = await getWallet(c.env, userId);
  if (!record.stripeConnectAccountId || !record.payoutsEnabled) {
    return c.json(message(c, "server.billing.connectRequired"), 400);
  }
  const amountMicros = yenToMicros(input.data.amountYen);
  const referenceId = crypto.randomUUID();
  // 保留中の売上 (直近の分) は残して引く
  const debit = await applyLedgerEntry(c.env, {
    userId,
    kind: "payout",
    balance: "earnings",
    amountMicros: -amountMicros,
    referenceId,
    description: `Payout ¥${input.data.amountYen}`,
    keepMicros: await recentEarningsMicros(c.env, userId),
  });
  if (debit !== "applied") {
    return c.json(message(c, "server.billing.insufficientEarnings"), 400);
  }

  const destination = record.stripeConnectAccountId;
  const stripe = getStripe(c.env);
  // 同じ冪等キーでやり直すので、Stripe 側で二重に送金されることはない
  const outcome = await transferWithRetry(() =>
    stripe.transfers.create(
      {
        amount: input.data.amountYen,
        currency: CURRENCY,
        destination,
        metadata: { userId, referenceId },
      },
      { idempotencyKey: `payout:${referenceId}` },
    ),
  );
  if (outcome.state === "sent") {
    return c.json({ ok: true, transferId: outcome.transferId });
  }
  console.error("Stripe の送金に失敗しました:", outcome.state, loggableError(outcome.error));
  if (outcome.state === "failed") {
    // 送金されていないことがはっきりしているときだけ売上を戻す
    await applyLedgerEntry(c.env, {
      userId,
      kind: "refund",
      balance: "earnings",
      amountMicros,
      referenceId,
      description: `Payout failed, returned ¥${microsToYen(amountMicros)}`,
    });
    return c.json(message(c, "server.billing.payoutFailed"), 502);
  }
  // 送金されたか分からない。売上は戻さず、照合待ちとして台帳に残す (Stripe の送金の metadata.referenceId で照合する)
  await applyLedgerEntry(c.env, {
    userId,
    kind: "payout_pending",
    balance: "earnings",
    amountMicros: 0,
    referenceId,
    description: `Payout ¥${input.data.amountYen} pending confirmation (${referenceId})`,
  });
  return c.json(
    { ...message(c, "server.billing.payoutPending"), ok: false, pending: true, referenceId },
    202,
  );
});

export default billing;
