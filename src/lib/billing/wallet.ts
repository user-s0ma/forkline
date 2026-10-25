import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, type Database } from "../db/client";
import { aiModel, ledgerEntry, usageRecord, wallet } from "../db/schema";
import { capCharge, type UsageCharge } from "./pricing";

/** モデルごとの1回あたりの平均の費用を、直近およそ何回の実行で均すか (指数移動平均) */
const AVG_COST_RUNS = 100;

export type LedgerKind =
  | "topup"
  | "payout"
  | "adjustment"
  | "refund"
  | "training"
  | "endpoint"
  | "dataset_build"
  | "evaluation"
  | "model_card"
  /** 出金の送金結果が分からず、照合待ちのもの (金額は動かさない) */
  | "payout_pending"
  /** チャージした支払いの返金・チャージバックで差し引いた分 (と、チャージバックに勝って戻した分) */
  | "chargeback";
export type LedgerBalance = "credit" | "earnings";

export async function ensureWallet(db: Database, organizationId: string) {
  await db
    .insert(wallet)
    .values({ organizationId })
    .onDuplicateKeyUpdate({ set: { organizationId } });
}

export async function getWallet(env: AppEnv, organizationId: string) {
  const [row] = await getDb(env)
    .select()
    .from(wallet)
    .where(eq(wallet.organizationId, organizationId))
    .limit(1);
  return (
    row ?? {
      organizationId,
      creditMicros: 0,
      earningsMicros: 0,
      stripeCustomerId: null,
      stripeConnectAccountId: null,
      payoutsEnabled: false,
      updatedAt: new Date(),
    }
  );
}

export async function getCreditMicros(env: AppEnv, organizationId: string) {
  return (await getWallet(env, organizationId)).creditMicros;
}

export function affectedRows(result: unknown) {
  if (!result || typeof result !== "object") return 0;
  const record = result as { rowsAffected?: number; affectedRows?: number };
  return record.rowsAffected ?? record.affectedRows ?? 0;
}

/**
 * 実行前に見込み額を残高から仮押さえする。残高が足りなければ false。
 * 「残高があるか確かめる」と「差し引く」を1つの条件付き更新にするので、
 * 同時にたくさん送られても押さえた分だけで止まり、残高がマイナスにならない。
 */
export async function reserveCredit(
  env: AppEnv,
  organizationId: string,
  micros: number,
) {
  if (micros <= 0) return true;
  const result = await getDb(env)
    .update(wallet)
    .set({ creditMicros: sql`${wallet.creditMicros} - ${micros}` })
    .where(
      and(
        eq(wallet.organizationId, organizationId),
        gte(wallet.creditMicros, micros),
      ),
    );
  return affectedRows(result) > 0;
}

/** 精算に進まなかった仮押さえを戻す */
export async function releaseCredit(
  env: AppEnv,
  organizationId: string,
  micros: number,
) {
  if (micros <= 0) return;
  await getDb(env)
    .update(wallet)
    .set({ creditMicros: sql`${wallet.creditMicros} + ${micros}` })
    .where(eq(wallet.organizationId, organizationId));
}

export type SettleInput = {
  /** 利用ログの ID。決めて渡せば、同じ精算をやり直しても二重にならない (重複キーで失敗する) */
  id?: string;
  model: { id: string; slug: string; organizationId: string };
  consumerOrganizationId: string;
  apiKeyId: string | null;
  userId: string | null;
  /** eval は評価 (src/lib/nemotron/run-evaluation.ts) から呼んだとき */
  source: "api" | "playground" | "eval";
  status: "succeeded" | "failed";
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  charge: UsageCharge;
  /** 実行前に仮押さえした額。実際の料金との差をここで清算する */
  heldMicros?: number;
};

/** usageRecord の int 列に収まるように丸める */
const INT_MAX = 2_147_483_647;
export function clampInt(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(INT_MAX, Math.max(0, Math.round(value)));
}

/**
 * 呼び出した組織のクレジットを引き落とし、公開した組織の売上に計上し、利用ログを残す。
 * 仮押さえした額との差だけを動かす。料金は呼び出し側 (gateway) で仮押さえ以下に抑えてあるので、
 * 呼び出しで残高がマイナスになることはない (念のため、ここでも仮押さえを上限にする)。
 */
export async function settleUsage(env: AppEnv, input: SettleInput) {
  const db = getDb(env);
  const id = input.id ?? crypto.randomUUID();
  if (input.heldMicros !== undefined && input.charge.totalMicros > input.heldMicros) {
    input = { ...input, charge: capCharge(input.charge, input.heldMicros) };
  }
  await db.transaction(async (tx) => {
    await ensureWallet(tx as unknown as Database, input.consumerOrganizationId);
    const due = input.charge.totalMicros - (input.heldMicros ?? 0);
    if (due !== 0) {
      await tx
        .update(wallet)
        .set({ creditMicros: sql`${wallet.creditMicros} - ${due}` })
        .where(eq(wallet.organizationId, input.consumerOrganizationId));
    }
    if (input.charge.creatorMicros > 0) {
      await ensureWallet(tx as unknown as Database, input.model.organizationId);
      await tx
        .update(wallet)
        .set({
          earningsMicros: sql`${wallet.earningsMicros} + ${input.charge.creatorMicros}`,
        })
        .where(eq(wallet.organizationId, input.model.organizationId));
    }
    await tx.insert(usageRecord).values({
      id,
      modelId: input.model.id,
      modelSlug: input.model.slug,
      publisherOrganizationId: input.model.organizationId,
      consumerOrganizationId: input.consumerOrganizationId,
      apiKeyId: input.apiKeyId,
      userId: input.userId,
      source: input.source,
      status: input.status,
      inputTokens: clampInt(input.inputTokens),
      outputTokens: clampInt(input.outputTokens),
      latencyMs: clampInt(input.latencyMs),
      totalMicros: input.charge.totalMicros,
      computeMicros: input.charge.computeMicros,
      creatorMicros: input.charge.creatorMicros,
      platformFeeMicros: input.charge.platformFeeMicros,
      createdAt: new Date(),
    });
    if (input.status === "succeeded") {
      const cost = input.charge.totalMicros;
      await tx
        .update(aiModel)
        .set({
          totalRequests: sql`${aiModel.totalRequests} + 1`,
          // 1回あたりの額の指数移動平均 (直近およそ AVG_COST_RUNS 回)。最初の実行はその額から始める。
          // 同時に精算しても取りこぼさないよう、DB の中で計算する
          avgCostMicros: sql`CASE WHEN ${aiModel.avgCostMicros} IS NULL THEN ${cost}
            ELSE ROUND((${aiModel.avgCostMicros} * ${AVG_COST_RUNS - 1} + ${cost}) / ${AVG_COST_RUNS}) END`,
        })
        .where(eq(aiModel.id, input.model.id));
    }
  });
  return id;
}

export function isDuplicateKeyError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  if (/Duplicate entry|ER_DUP_ENTRY|\b1062\b/.test(message)) return true;
  return error instanceof Error && isDuplicateKeyError(error.cause);
}

function isRollback(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "TransactionRollbackError" || /rollback/i.test(error.message))
  );
}

/**
 * 台帳に1行追加して残高を動かす。referenceId が同じ kind で既にあれば何もしない (冪等)。
 * 残高不足で引き落とせない場合は "insufficient" を返す。
 * keepMicros: 引いたあとに最低限残すべき額 (出金で、まだ出金できない売上を残すため)
 * allowNegative: 残高が足りなくても引く (返金・チャージバックは、使ってしまった分もマイナスにして取り戻す)
 */
export async function applyLedgerEntry(
  env: AppEnv,
  entry: {
    organizationId: string;
    kind: LedgerKind;
    balance: LedgerBalance;
    amountMicros: number;
    referenceId: string | null;
    description: string;
    keepMicros?: number;
    allowNegative?: boolean;
  },
): Promise<"applied" | "duplicate" | "insufficient"> {
  const db = getDb(env);
  const column =
    entry.balance === "credit" ? wallet.creditMicros : wallet.earningsMicros;
  try {
    return await db.transaction(async (tx) => {
      await ensureWallet(tx as unknown as Database, entry.organizationId);
      await tx.insert(ledgerEntry).values({
        id: crypto.randomUUID(),
        organizationId: entry.organizationId,
        kind: entry.kind,
        balance: entry.balance,
        amountMicros: entry.amountMicros,
        referenceId: entry.referenceId,
        description: entry.description.slice(0, 255),
        createdAt: new Date(),
      });
      const conditions = [eq(wallet.organizationId, entry.organizationId)];
      if (entry.amountMicros < 0 && !entry.allowNegative) {
        conditions.push(gte(column, -entry.amountMicros + Math.max(0, entry.keepMicros ?? 0)));
      }
      const result = await tx
        .update(wallet)
        .set(
          entry.balance === "credit"
            ? { creditMicros: sql`${column} + ${entry.amountMicros}` }
            : { earningsMicros: sql`${column} + ${entry.amountMicros}` },
        )
        .where(and(...conditions));
      if (!affectedRows(result)) {
        tx.rollback();
      }
      return "applied" as const;
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) return "duplicate";
    if (isRollback(error)) return "insufficient";
    throw error;
  }
}

export type HoldSettlement = {
  organizationId: string;
  /** dataset_build / evaluation / model_card は Token Factory の Nemotron のトークン代 */
  kind: "training" | "endpoint" | "dataset_build" | "evaluation" | "model_card";
  /** 同じ精算を二度しないための ID (学習なら学習の ID) */
  referenceId: string;
  /** 先に仮押さえしてあった額 (仮押さえが無ければ 0) */
  heldMicros: number;
  /** 実際の料金 */
  actualMicros: number;
  description: string;
};

/** 仮押さえと実際の料金の差。残高はこの分だけ動かす (正なら戻し、負なら追加で引く) */
export function holdDifference(heldMicros: number, actualMicros: number) {
  return Math.max(0, heldMicros) - Math.max(0, actualMicros);
}

/**
 * 仮押さえを実際の料金で清算する。台帳には実際の料金を1行で残し、残高は仮押さえとの差だけ動かす。
 * 同じ referenceId で二度呼んでも二重に引かない。見込みより高くついた分で残高がマイナスになることは許容する
 * (GPU はもう使ってしまっているため)。
 */
export async function settleHold(
  env: AppEnv,
  input: HoldSettlement,
): Promise<"applied" | "duplicate"> {
  const db = getDb(env);
  try {
    await db.transaction(async (tx) => {
      await writeHoldSettlement(tx as unknown as Database, input);
    });
    return "applied";
  } catch (error) {
    if (isDuplicateKeyError(error)) return "duplicate";
    throw error;
  }
}

/** settleHold の中身。ほかの更新と同じトランザクションで精算したいときに使う */
export async function writeHoldSettlement(tx: Database, input: HoldSettlement) {
  const actual = Math.max(0, Math.ceil(input.actualMicros));
  await ensureWallet(tx, input.organizationId);
  await tx.insert(ledgerEntry).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    kind: input.kind,
    balance: "credit",
    amountMicros: -actual,
    referenceId: input.referenceId,
    description: input.description.slice(0, 255),
    createdAt: new Date(),
  });
  const delta = holdDifference(input.heldMicros, actual);
  if (delta !== 0) {
    await tx
      .update(wallet)
      .set({ creditMicros: sql`${wallet.creditMicros} + ${delta}` })
      .where(eq(wallet.organizationId, input.organizationId));
  }
}

export async function updateWallet(
  env: AppEnv,
  organizationId: string,
  values: {
    stripeCustomerId?: string;
    stripeConnectAccountId?: string;
    payoutsEnabled?: boolean;
  },
) {
  const db = getDb(env);
  await ensureWallet(db, organizationId);
  await db.update(wallet).set(values).where(eq(wallet.organizationId, organizationId));
}

/** 学習とエンドポイントのための仮押さえの合計 (残高の画面で「押さえ中」として見せる) */
export function sumHeld(rows: Array<{ heldMicros: number }>) {
  return rows.reduce((sum, row) => sum + Math.max(0, row.heldMicros), 0);
}
