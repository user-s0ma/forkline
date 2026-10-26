import {
  boolean,
  datetime,
  index,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

const id = () => varchar("id", { length: 191 }).primaryKey();
const createdAt = () =>
  datetime("createdAt", { mode: "date", fsp: 3 })
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .notNull();
const updatedAt = () =>
  datetime("updatedAt", { mode: "date", fsp: 3 })
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdate(() => new Date())
    .notNull();

export const user = mysqlTable("User", {
  id: id(),
  name: varchar("name", { length: 191 }).notNull(),
  email: varchar("email", { length: 191 }).unique().notNull(),
  emailVerified: boolean("emailVerified").default(false).notNull(),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = mysqlTable(
  "Session",
  {
    id: id(),
    expiresAt: datetime("expiresAt", { mode: "date", fsp: 3 }).notNull(),
    token: varchar("token", { length: 191 }).unique().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: varchar("userId", { length: 191 }).notNull(),
  },
  (table) => [index("Session_userId_idx").on(table.userId)],
);

export const account = mysqlTable(
  "Account",
  {
    id: id(),
    accountId: varchar("accountId", { length: 191 }).notNull(),
    providerId: varchar("providerId", { length: 191 }).notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: datetime("accessTokenExpiresAt", {
      mode: "date",
      fsp: 3,
    }),
    refreshTokenExpiresAt: datetime("refreshTokenExpiresAt", {
      mode: "date",
      fsp: 3,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("Account_userId_idx").on(table.userId),
    uniqueIndex("Account_provider_account_idx").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const verification = mysqlTable("Verification", {
  id: id(),
  identifier: varchar("identifier", { length: 191 }).notNull(),
  value: text("value").notNull(),
  expiresAt: datetime("expiresAt", { mode: "date", fsp: 3 }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
