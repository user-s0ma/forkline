import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { generateApiKey } from "@/lib/billing/api-keys";
import { getDb } from "@/lib/db/client";
import { apiKey } from "@/lib/db/schema";
import { currentUser, requireUser } from "./session";
import { message } from "./shared";
import type { ApiEnv } from "../types";

const MAX_ACTIVE_KEYS = 50;

const createSchema = z.object({ name: z.string().trim().min(1).max(80) });

const apiKeys = new Hono<ApiEnv>();

apiKeys.use("/api-keys", requireUser());
apiKeys.use("/api-keys/*", requireUser());

function toDto(row: typeof apiKey.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

apiKeys.get("/api-keys", async (c) => {
  const rows = await getDb(c.env)
    .select()
    .from(apiKey)
    .where(
      and(
        eq(apiKey.userId, currentUser(c).id),
        isNull(apiKey.revokedAt),
      ),
    )
    .orderBy(desc(apiKey.createdAt))
    .limit(MAX_ACTIVE_KEYS);
  return c.json({ items: rows.map(toDto) });
});

apiKeys.post("/api-keys", async (c) => {
  const userId = currentUser(c).id;
  const input = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json(message(c, "server.apiKeys.invalidInput"), 400);
  const db = getDb(c.env);
  const active = await db.$count(
    apiKey,
    and(eq(apiKey.userId, userId), isNull(apiKey.revokedAt)),
  );
  if (active >= MAX_ACTIVE_KEYS) {
    return c.json(message(c, "server.apiKeys.limit", { max: MAX_ACTIVE_KEYS }), 400);
  }
  const { key, prefix, keyHash } = await generateApiKey();
  const row = {
    id: crypto.randomUUID(),
    userId,
    name: input.data.name,
    prefix,
    keyHash,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date(),
  };
  await db.insert(apiKey).values(row);
  return c.json({ ...toDto(row), key }, 201);
});

apiKeys.delete("/api-keys/:keyId", async (c) => {
  const userId = currentUser(c).id;
  const db = getDb(c.env);
  const [row] = await db
    .select({ id: apiKey.id, name: apiKey.name, prefix: apiKey.prefix })
    .from(apiKey)
    .where(
      and(
        eq(apiKey.userId, userId),
        eq(apiKey.id, c.req.param("keyId")),
        isNull(apiKey.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return c.json({ ok: true });
  await db.update(apiKey).set({ revokedAt: new Date() }).where(eq(apiKey.id, row.id));
  return c.json({ ok: true });
});

export default apiKeys;
