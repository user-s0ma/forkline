import { sql } from "drizzle-orm";
import {
  datetime,
  index,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

export const auditLog = mysqlTable(
  "AuditLog",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 191 }).notNull(),
    actorId: varchar("actorId", { length: 191 }).notNull(),
    actorName: varchar("actorName", { length: 191 }).notNull(),
    actorEmail: varchar("actorEmail", { length: 191 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    targetId: varchar("targetId", { length: 191 }),
    targetLabel: varchar("targetLabel", { length: 500 }).notNull(),
    metadata: text("metadata").notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .notNull(),
  },
  (table) => [
    index("AuditLog_organization_createdAt_idx").on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
  ],
);
