import { sql, type SQLWrapper } from "drizzle-orm";

export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const DAY_MS = 86_400_000;

export function toLocalTime(date = new Date()) {
  return new Date(date.getTime() + JST_OFFSET_MS);
}

export function formatLocalDateTime(value: string | Date) {
  const local = toLocalTime(value instanceof Date ? value : new Date(value));
  const weekday = "日月火水木金土"[local.getUTCDay()];
  return `${local.getUTCMonth() + 1}/${local.getUTCDate()}(${weekday}) ${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

export function localDayIndex(time: number) {
  return Math.floor((time + JST_OFFSET_MS) / DAY_MS);
}

export function startOfLocalDay(time: number) {
  return localDayIndex(time) * DAY_MS - JST_OFFSET_MS;
}

export function localDayIndexSql(column: SQLWrapper) {
  return sql<string>`floor((${column} + ${JST_OFFSET_MS}) / ${DAY_MS})`;
}
