import { sql } from "drizzle-orm";
import {
  bigint,
  datetime,
  index,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const aiModel = mysqlTable(
  "AiModel",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 191 }).notNull(),
    createdBy: varchar("createdBy", { length: 191 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    tagline: varchar("tagline", { length: 160 }).notNull(),
    description: text("description").notNull(),
    category: varchar("category", { length: 32 }).notNull(),
    tags: text("tags").notNull(),
    /** 実行の設定 (JSON。src/lib/models/config.ts の modelConfigSchema) */
    config: text("config").notNull(),
    visibility: varchar("visibility", { length: 16 })
      .default("private")
      .notNull(),
    /** draft / published / suspended */
    status: varchar("status", { length: 16 }).default("draft").notNull(),
    /** 載せている Nemotron (Hugging Face のリポジトリ名) */
    baseModelId: varchar("baseModelId", { length: 191 }),
    /** 載せている LoRA と、それを作った学習 */
    adapterUri: varchar("adapterUri", { length: 1000 }),
    fineTuneId: varchar("fineTuneId", { length: 191 }),
    /** Nebius のエンドポイント */
    endpointId: varchar("endpointId", { length: 191 }),
    /** none / starting / running / stopping / stopped / failed */
    endpointStatus: varchar("endpointStatus", { length: 16 })
      .default("none")
      .notNull(),
    endpointUrl: varchar("endpointUrl", { length: 1000 }),
    /** エンドポイントの Bearer トークン (暗号化して保存) */
    endpointToken: text("endpointToken"),
    /** 載せたときの GPU の1時間あたりの料金 (上乗せ込み、マイクロ円)。動いていた時間はこの単価で請求する */
    endpointMicrosPerHour: bigint("endpointMicrosPerHour", { mode: "number" })
      .default(0)
      .notNull(),
    endpointError: varchar("endpointError", { length: 500 }),
    endpointLastUsedAt: datetime("endpointLastUsedAt", { mode: "date", fsp: 3 }),
    /** 起動してから、まだ請求していない区間の始まり。止まっているときは null */
    endpointMeteredAt: datetime("endpointMeteredAt", { mode: "date", fsp: 3 }),
    /** 起動したときに公開した組織の残高から仮押さえした額。止めたときに戻す */
    endpointHeldMicros: bigint("endpointHeldMicros", { mode: "number" })
      .default(0)
      .notNull(),
    priceInputMicros: bigint("priceInputMicros", { mode: "number" })
      .default(0)
      .notNull(),
    priceOutputMicros: bigint("priceOutputMicros", { mode: "number" })
      .default(0)
      .notNull(),
    pricePerRequestMicros: bigint("pricePerRequestMicros", { mode: "number" })
      .default(0)
      .notNull(),
    totalRequests: bigint("totalRequests", { mode: "number" })
      .default(0)
      .notNull(),
    /** 成功した実行で実際に請求した額の、直近およそ100回の指数移動平均 */
    avgCostMicros: bigint("avgCostMicros", { mode: "number" }),
    publishedAt: datetime("publishedAt", { mode: "date", fsp: 3 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("AiModel_slug_key").on(table.slug),
    index("AiModel_organization_updatedAt_idx").on(
      table.organizationId,
      table.updatedAt,
    ),
    index("AiModel_listing_idx").on(
      table.status,
      table.visibility,
      table.publishedAt,
    ),
    // 定期処理で、動いているエンドポイントを探すため
    index("AiModel_endpointStatus_idx").on(table.endpointStatus),
  ],
);
