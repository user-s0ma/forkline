import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { aiModel, fineTune } from "@/lib/db/schema";
import { computeDeps } from "@/lib/compute/deps";
import {
  ACTIVE_FINE_TUNE_STATUSES,
  refreshFineTune,
} from "@/lib/compute/fine-tune";
import { LIVE_ENDPOINT_STATUSES, sweepEndpoint } from "@/lib/compute/endpoint";
import type { FineTuneRow, ModelRow } from "@/lib/compute/types";

/** 1回に読む件数 */
const PAGE_SIZE = 100;
/** 1回の見回りで使う時間の上限。残りは次の見回りに回す (古いものから順に扱うので、取り残されない) */
const SWEEP_BUDGET_MS = 45_000;

/**
 * ページごとに読み、ページの中は並べて処理する。読み終わるか、時間の上限を過ぎたら止める。
 * fetchPage には前のページの最後の行を渡す (最初は null)
 */
export async function forEachPage<T>(
  fetchPage: (after: T | null) => Promise<T[]>,
  handle: (row: T) => Promise<unknown>,
  options: { pageSize: number; deadline: number; now?: () => number },
) {
  const now = options.now ?? Date.now;
  let after: T | null = null;
  let processed = 0;
  for (;;) {
    const rows = await fetchPage(after);
    const results = await Promise.allSettled(rows.map(handle));
    for (const result of results) {
      if (result.status === "rejected") console.error("見回りに失敗しました:", result.reason);
    }
    processed += rows.length;
    if (rows.length < options.pageSize || now() >= options.deadline) break;
    after = rows[rows.length - 1];
  }
  return processed;
}

/** 終わっていない学習を古い順に */
function fineTunePage(db: ReturnType<typeof getDb>, after: FineTuneRow | null) {
  const conditions: SQL[] = [inArray(fineTune.status, [...ACTIVE_FINE_TUNE_STATUSES])];
  if (after) {
    conditions.push(
      or(
        gt(fineTune.createdAt, after.createdAt),
        and(eq(fineTune.createdAt, after.createdAt), gt(fineTune.id, after.id)),
      )!,
    );
  }
  return db
    .select()
    .from(fineTune)
    .where(and(...conditions))
    .orderBy(asc(fineTune.createdAt), asc(fineTune.id))
    .limit(PAGE_SIZE);
}

/**
 * 動いているエンドポイントを、請求が古い順に。見回りで請求した行は起点が startedAt より後になるので、
 * 同じ回にもう一度読むことはない
 */
function endpointPage(db: ReturnType<typeof getDb>, startedAt: Date, after: ModelRow | null) {
  const conditions: SQL[] = [
    inArray(aiModel.endpointStatus, [...LIVE_ENDPOINT_STATUSES]),
    or(isNull(aiModel.endpointMeteredAt), lte(aiModel.endpointMeteredAt, startedAt))!,
  ];
  if (after) {
    const at = after.endpointMeteredAt;
    conditions.push(
      at
        ? or(
            gt(aiModel.endpointMeteredAt, at),
            and(eq(aiModel.endpointMeteredAt, at), gt(aiModel.id, after.id)),
          )!
        : or(
            isNotNull(aiModel.endpointMeteredAt),
            and(isNull(aiModel.endpointMeteredAt), gt(aiModel.id, after.id)),
          )!,
    );
  }
  // MySQL では null が先に並ぶ
  return db
    .select()
    .from(aiModel)
    .where(and(...conditions))
    .orderBy(asc(aiModel.endpointMeteredAt), asc(aiModel.id))
    .limit(PAGE_SIZE);
}

/**
 * 1分ごとの見回り (server.mjs が回す)。
 * - 終わっていない学習の状態を Nebius に問い合わせ、終わっていれば精算する
 * - 動いているエンドポイントの GPU 代を請求し、待ち時間を過ぎたもの・残高が尽きた組織のものを止める
 * 件数が多くても全部を見られるよう、ページごとに読み進める
 */
export async function runScheduled(env: AppEnv) {
  const db = getDb(env);
  const deps = computeDeps(env);
  const startedAt = new Date();
  const deadline = startedAt.getTime() + SWEEP_BUDGET_MS;

  await Promise.all([
    forEachPage<FineTuneRow>(
      (after) => fineTunePage(db, after),
      (row) => refreshFineTune(deps, row),
      { pageSize: PAGE_SIZE, deadline },
    ),
    forEachPage<ModelRow>(
      (after) => endpointPage(db, startedAt, after),
      (row) => sweepEndpoint(deps, row),
      { pageSize: PAGE_SIZE, deadline },
    ),
  ]);
}
