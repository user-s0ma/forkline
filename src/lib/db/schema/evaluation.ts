import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  datetime,
  index,
  int,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * 微調整したモデルの評価。取っておいた評価用の例を、微調整したエンドポイントと
 * Token Factory のベースの Nemotron の両方に解かせ、Nemotron が採点する。
 */
export const evalRun = mysqlTable(
  "EvalRun",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 191 }).notNull(),
    modelId: varchar("modelId", { length: 191 }).notNull(),
    /** 評価した LoRA を作った学習 */
    fineTuneId: varchar("fineTuneId", { length: 191 }).notNull(),
    createdBy: varchar("createdBy", { length: 191 }).notNull(),
    /** running / succeeded / failed / canceled */
    status: varchar("status", { length: 16 }).notNull(),
    /** 比べる相手 (Token Factory のモデル ID) と採点役 */
    baselineModel: varchar("baselineModel", { length: 191 }).notNull(),
    judgeModel: varchar("judgeModel", { length: 191 }).notNull(),
    itemCount: int("itemCount").notNull(),
    /** EvalSummary の JSON。終わるまでは null */
    summary: text("summary"),
    /** Token Factory に払った額の合計 (台帳には呼び出しごとに残る) */
    costMicros: bigint("costMicros", { mode: "number" }).default(0).notNull(),
    error: varchar("error", { length: 500 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .notNull(),
    completedAt: datetime("completedAt", { mode: "date", fsp: 3 }),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("EvalRun_model_createdAt_idx").on(table.modelId, table.createdAt),
    index("EvalRun_organization_createdAt_idx").on(table.organizationId, table.createdAt),
  ],
);

/** 評価の1問。両方の答えと採点を持つ */
export const evalItem = mysqlTable(
  "EvalItem",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    runId: varchar("runId", { length: 191 }).notNull(),
    position: int("position").notNull(),
    /** 質問までの会話 (ChatMessage[] の JSON) */
    prompt: text("prompt").notNull(),
    /** 評価用の例に書かれていた答え (採点の基準) */
    reference: text("reference").notNull(),
    /** pending / running / done / failed */
    status: varchar("status", { length: 16 }).default("pending").notNull(),
    /** 取りかかった回数。Token Factory の精算の referenceId に入れる */
    attempts: int("attempts").default(0).notNull(),
    claimedAt: datetime("claimedAt", { mode: "date", fsp: 3 }),
    /** 採点のときに微調整したモデルの答えを A に置いたか (位置の偏りを打ち消すため問ごとに入れ替える) */
    fineTunedFirst: boolean("fineTunedFirst").notNull(),
    fineTunedAnswer: text("fineTunedAnswer"),
    baseAnswer: text("baseAnswer"),
    fineTunedScore: int("fineTunedScore"),
    baseScore: int("baseScore"),
    fineTunedReason: varchar("fineTunedReason", { length: 300 }),
    baseReason: varchar("baseReason", { length: 300 }),
    error: varchar("error", { length: 500 }),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("EvalItem_run_position_key").on(table.runId, table.position),
    index("EvalItem_run_status_idx").on(table.runId, table.status),
  ],
);
