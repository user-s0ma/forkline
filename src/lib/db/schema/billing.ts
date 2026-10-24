import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  datetime,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** 組織ごとの残高。クレジット (使う分) と売上 (出金できる分) を分けて持つ */
export const wallet = mysqlTable("Wallet", {
  organizationId: varchar("organizationId", { length: 191 }).primaryKey(),
  creditMicros: bigint("creditMicros", { mode: "number" }).default(0).notNull(),
  earningsMicros: bigint("earningsMicros", { mode: "number" })
    .default(0)
    .notNull(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 191 }),
  stripeConnectAccountId: varchar("stripeConnectAccountId", { length: 191 }),
  payoutsEnabled: boolean("payoutsEnabled").default(false).notNull(),
  updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdate(() => new Date())
    .notNull(),
});

export const ledgerEntry = mysqlTable(
  "LedgerEntry",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 191 }).notNull(),
    /** topup / payout / refund / adjustment / training / endpoint / dataset_build / evaluation / model_card */
    kind: varchar("kind", { length: 16 }).notNull(),
    /** credit / earnings */
    balance: varchar("balance", { length: 16 }).notNull(),
    amountMicros: bigint("amountMicros", { mode: "number" }).notNull(),
    referenceId: varchar("referenceId", { length: 191 }),
    description: varchar("description", { length: 255 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .notNull(),
  },
  (table) => [
    index("LedgerEntry_organization_createdAt_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    uniqueIndex("LedgerEntry_kind_referenceId_key").on(
      table.kind,
      table.referenceId,
    ),
  ],
);

/** 1回の呼び出しの記録。公開した組織と呼び出した組織の両方を持つ */
export const usageRecord = mysqlTable(
  "UsageRecord",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    modelId: varchar("modelId", { length: 191 }).notNull(),
    modelSlug: varchar("modelSlug", { length: 64 }).notNull(),
    publisherOrganizationId: varchar("publisherOrganizationId", {
      length: 191,
    }).notNull(),
    consumerOrganizationId: varchar("consumerOrganizationId", {
      length: 191,
    }).notNull(),
    apiKeyId: varchar("apiKeyId", { length: 191 }),
    /** プレイグラウンドから呼んだ人 */
    userId: varchar("userId", { length: 191 }),
    /** api / playground / eval */
    source: varchar("source", { length: 16 }).notNull(),
    /** succeeded / failed */
    status: varchar("status", { length: 16 }).notNull(),
    inputTokens: int("inputTokens").default(0).notNull(),
    outputTokens: int("outputTokens").default(0).notNull(),
    latencyMs: int("latencyMs").default(0).notNull(),
    totalMicros: bigint("totalMicros", { mode: "number" }).notNull(),
    computeMicros: bigint("computeMicros", { mode: "number" }).notNull(),
    creatorMicros: bigint("creatorMicros", { mode: "number" }).notNull(),
    platformFeeMicros: bigint("platformFeeMicros", { mode: "number" }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .notNull(),
  },
  (table) => [
    index("UsageRecord_consumer_createdAt_idx").on(
      table.consumerOrganizationId,
      table.createdAt,
    ),
    index("UsageRecord_publisher_createdAt_idx").on(
      table.publisherOrganizationId,
      table.createdAt,
    ),
    index("UsageRecord_modelId_createdAt_idx").on(
      table.modelId,
      table.createdAt,
    ),
  ],
);

export const apiKey = mysqlTable(
  "ApiKey",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 191 }).notNull(),
    createdBy: varchar("createdBy", { length: 191 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    prefix: varchar("prefix", { length: 16 }).notNull(),
    keyHash: varchar("keyHash", { length: 64 }).notNull(),
    lastUsedAt: datetime("lastUsedAt", { mode: "date", fsp: 3 }),
    revokedAt: datetime("revokedAt", { mode: "date", fsp: 3 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("ApiKey_keyHash_key").on(table.keyHash),
    index("ApiKey_organization_createdAt_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);
