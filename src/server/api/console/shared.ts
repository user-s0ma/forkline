import { and, eq, lt, or, type SQL } from "drizzle-orm";
import type { Context } from "hono";
import type { MySqlColumn } from "drizzle-orm/mysql-core";
import { getDb } from "@/lib/db/client";
import { aiModel } from "@/lib/db/schema";
import { detectLocale, translate } from "@/lib/i18n";
import { decodeCursor } from "@/lib/util/cursor";
import type { ApiEnv } from "../types";

export function pageSizeOf(raw: string | undefined) {
  return Math.min(100, Math.max(1, Number.parseInt(raw || "50", 10) || 50));
}

/** 作成日時の新しい順に並べたときの、カーソルより後ろの条件 */
export function cursorCondition(
  raw: string | undefined,
  dateColumn: MySqlColumn,
  idColumn: MySqlColumn,
): SQL | undefined {
  const cursor = decodeCursor(raw);
  if (!cursor || typeof cursor.value !== "string") return undefined;
  const at = new Date(cursor.value);
  return or(lt(dateColumn, at), and(eq(dateColumn, at), lt(idColumn, cursor.id)));
}

export function message(
  c: Context<ApiEnv>,
  key: string,
  vars?: Record<string, string | number>,
) {
  return { message: translate(detectLocale(c.req.raw), key, vars) };
}

export async function loadOwnModel(
  env: AppEnv,
  userId: string,
  modelId: string,
) {
  const [row] = await getDb(env)
    .select()
    .from(aiModel)
    .where(and(eq(aiModel.userId, userId), eq(aiModel.id, modelId)))
    .limit(1);
  return row ?? null;
}
