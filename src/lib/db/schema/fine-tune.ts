import { sql } from "drizzle-orm";
import {
  bigint,
  datetime,
  index,
  int,
  mediumtext,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** Nemotron の LoRA 学習。Nebius の Serverless AI の Job として動かす */
export const fineTune = mysqlTable(
  "FineTune",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    userId: varchar("userId", { length: 191 }).notNull(),
    modelId: varchar("modelId", { length: 191 }).notNull(),
    baseModelId: varchar("baseModelId", { length: 191 }).notNull(),
    /** 学習に使う GPU のプリセット */
    trainPreset: varchar("trainPreset", { length: 64 }).notNull(),
    /** 始めたときの GPU の1時間あたりの料金 (上乗せ込み、マイクロ円)。精算はこの単価で行う */
    trainMicrosPerHour: bigint("trainMicrosPerHour", { mode: "number" }).notNull(),
    datasetName: varchar("datasetName", { length: 255 }).notNull(),
    datasetUri: varchar("datasetUri", { length: 1000 }),
    datasetBytes: int("datasetBytes").notNull(),
    datasetExamples: int("datasetExamples").notNull(),
    /** upload (JSONL を選んだ) / builder (Nemotron で作った) */
    datasetSource: varchar("datasetSource", { length: 16 }).default("upload").notNull(),
    /** モデルカードの下書きに使う学習データの要約 (DatasetSummary の JSON) */
    datasetSummary: text("datasetSummary"),
    /** 学習に使わずに取っておいた評価用の例 (chat 形式の JSONL)。評価はここから読む */
    evalSet: mediumtext("evalSet"),
    evalExamples: int("evalExamples").default(0).notNull(),
    /** FineTuneHyperparameters の JSON */
    hyperparameters: text("hyperparameters").notNull(),
    nebiusJobId: varchar("nebiusJobId", { length: 191 }),
    /**
     * 終わっていない (queued / running) 間だけモデルの ID を入れ、終わったら null にする。
     * 一意の索引で、1つのモデルで同時に2つの学習が走らないようにする (null は重複してよい)
     */
    activeKey: varchar("activeKey", { length: 191 }),
    /** queued / running / succeeded / failed / canceled */
    status: varchar("status", { length: 16 }).notNull(),
    adapterUri: varchar("adapterUri", { length: 1000 }),
    error: varchar("error", { length: 500 }),
    /** 始める前に見積もった額 */
    estimatedMicros: bigint("estimatedMicros", { mode: "number" })
      .default(0)
      .notNull(),
    /** 始めるときに仮押さえした額。終わったときの精算で清算して 0 にする */
    heldMicros: bigint("heldMicros", { mode: "number" }).default(0).notNull(),
    /** 精算した額 (終わるまでは 0) */
    costMicros: bigint("costMicros", { mode: "number" }).default(0).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .notNull(),
    startedAt: datetime("startedAt", { mode: "date", fsp: 3 }),
    completedAt: datetime("completedAt", { mode: "date", fsp: 3 }),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("FineTune_model_createdAt_idx").on(table.modelId, table.createdAt),
    index("FineTune_user_createdAt_idx").on(
      table.userId,
      table.createdAt,
    ),
    // 定期処理で、終わっていない学習を探すため
    index("FineTune_status_idx").on(table.status),
    uniqueIndex("FineTune_activeKey_key").on(table.activeKey),
  ],
);
