import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { generateApiKey } from "@/lib/billing/api-keys";
import { getDb } from "@/lib/db/client";
import { apiKey } from "@/lib/db/schema";
import { recordAuditLog } from "@/lib/organization/audit";
import { organizationAuth, requireRole } from "./access";
import { actorOf, MANAGER_ROLES, message } from "./shared";
import type { ApiEnv } from "../types";

const MAX_ACTIVE_KEYS = 50;

const createSchema = z.object({ name: z.string().trim().min(1).max(80) });

const apiKeys = new Hono<ApiEnv>();

apiKeys.use("/:organizationId/api-keys", organizationAuth());
apiKeys.use("/:organizationId/api-keys/*", organizationAuth());

function toDto(row: typeof apiKey.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** キーは組織で共有する。一覧はメンバー全員が見られるが、発行と失効は管理者だけ */
apiKeys.get("/:organizationId/api-keys", async (c) => {
  const rows = await getDb(c.env)
    .select()
    .from(apiKey)
    .where(
      and(
        eq(apiKey.organizationId, c.req.param("organizationId")),
        isNull(apiKey.revokedAt),
      ),
    )
    .orderBy(desc(apiKey.createdAt))
    .limit(MAX_ACTIVE_KEYS);
  return c.json({ items: rows.map(toDto) });
});

apiKeys.post(
  "/:organizationId/api-keys",
  requireRole(...MANAGER_ROLES),
  async (c) => {
    const organizationId = c.req.param("organizationId");
    const input = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json(message(c, "server.apiKeys.invalidInput"), 400);
    const db = getDb(c.env);
    const active = await db.$count(
      apiKey,
      and(eq(apiKey.organizationId, organizationId), isNull(apiKey.revokedAt)),
    );
    if (active >= MAX_ACTIVE_KEYS) {
      return c.json(message(c, "server.apiKeys.limit", { max: MAX_ACTIVE_KEYS }), 400);
    }
    const actor = actorOf(c);
    const { key, prefix, keyHash } = await generateApiKey();
    const row = {
      id: crypto.randomUUID(),
      organizationId,
      createdBy: actor.id,
      name: input.data.name,
      prefix,
      keyHash,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    await db.insert(apiKey).values(row);
    await recordAuditLog(c.env, {
      organizationId,
      actor,
      action: "api_key.create",
      targetId: row.id,
      targetLabel: row.name,
      metadata: { prefix },
    });
    return c.json({ ...toDto(row), key }, 201);
  },
);

apiKeys.delete(
  "/:organizationId/api-keys/:keyId",
  requireRole(...MANAGER_ROLES),
  async (c) => {
    const organizationId = c.req.param("organizationId");
    const db = getDb(c.env);
    const [row] = await db
      .select({ id: apiKey.id, name: apiKey.name, prefix: apiKey.prefix })
      .from(apiKey)
      .where(
        and(
          eq(apiKey.organizationId, organizationId),
          eq(apiKey.id, c.req.param("keyId")),
          isNull(apiKey.revokedAt),
        ),
      )
      .limit(1);
    if (!row) return c.json({ ok: true });
    await db.update(apiKey).set({ revokedAt: new Date() }).where(eq(apiKey.id, row.id));
    await recordAuditLog(c.env, {
      organizationId,
      actor: actorOf(c),
      action: "api_key.revoke",
      targetId: row.id,
      targetLabel: row.name,
      metadata: { prefix: row.prefix },
    });
    return c.json({ ok: true });
  },
);

export default apiKeys;
