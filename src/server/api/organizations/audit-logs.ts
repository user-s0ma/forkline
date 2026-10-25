import { and, desc, eq, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { AUDIT_ACTIONS } from "@/lib/organization/audit";
import { decodeCursor, encodeCursor } from "@/lib/util/cursor";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { organizationAuth, requireRole } from "./access";
import type { ApiEnv } from "../types";

const auditLogs = new Hono<ApiEnv>();

auditLogs.use("/:organizationId/*", organizationAuth());

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

auditLogs.get(
  "/:organizationId/audit-logs",
  requireRole("owner", "admin"),
  async (c) => {
    const organizationId = c.req.param("organizationId");
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(c.req.query("pageSize") || "50", 10) || 50),
    );
    const cursor = decodeCursor(c.req.query("cursor"));
    const action = AUDIT_ACTIONS.find(
      (value) => value === c.req.query("action"),
    );

    const conditions = [eq(auditLog.organizationId, organizationId)];
    if (action) conditions.push(eq(auditLog.action, action));
    if (cursor && typeof cursor.value === "string") {
      const boundaryAt = new Date(cursor.value);
      const boundary = or(
        lt(auditLog.createdAt, boundaryAt),
        and(eq(auditLog.createdAt, boundaryAt), lt(auditLog.id, cursor.id)),
      );
      if (boundary) conditions.push(boundary);
    }

    const rows = await getDb(c.env)
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(pageSize + 1);
    const hasMore = rows.length > pageSize;
    const pageRows = rows.slice(0, pageSize);
    const lastRow = pageRows[pageRows.length - 1];

    return c.json({
      items: pageRows.map((record) => ({
        id: record.id,
        actorId: record.actorId,
        actorName: record.actorName,
        actorEmail: record.actorEmail,
        action: record.action,
        targetId: record.targetId,
        targetLabel: record.targetLabel,
        metadata: parseMetadata(record.metadata),
        createdAt: record.createdAt.toISOString(),
      })),
      nextCursor:
        hasMore && lastRow ? encodeCursor(lastRow.createdAt, lastRow.id) : null,
    });
  },
);

export default auditLogs;
