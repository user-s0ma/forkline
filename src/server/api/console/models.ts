import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { encodeCursor } from "@/lib/util/cursor";
import { getDb } from "@/lib/db/client";
import { aiModel, fineTune, usageRecord } from "@/lib/db/schema";
import {
  defaultModelConfig,
  modelConfigSchema,
  modelMetadataSchema,
  modelPricingSchema,
  parseModelConfig,
  parseTags,
} from "@/lib/models/config";
import { SLUG_PATTERN, toModelSlug } from "@/lib/billing/pricing";
import { computeDeps } from "@/lib/compute/deps";
import {
  deployEndpoint,
  refreshEndpoint,
  removeEndpoint,
  stopEndpointFor,
  wakeEndpoint,
} from "@/lib/compute/endpoint";
import {
  ACTIVE_FINE_TUNE_STATUSES,
  cancelFineTune,
} from "@/lib/compute/fine-tune";
import type { ModelRow } from "@/lib/compute/types";
import { currentUser, requireUser } from "./session";
import {
  cursorCondition,
  loadOwnModel,
  message,
  pageSizeOf,
} from "./shared";
import type { ApiEnv } from "../types";

export function toModelDto(row: ModelRow) {
  return {
    id: row.id,
    userId: row.userId,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    category: row.category,
    tags: parseTags(row.tags),
    config: parseModelConfig(row.config) ?? defaultModelConfig(),
    visibility: row.visibility,
    status: row.status,
    baseModelId: row.baseModelId,
    adapterUri: row.adapterUri,
    fineTuneId: row.fineTuneId,
    endpointId: row.endpointId,
    endpointStatus: row.endpointStatus,
    endpointError: row.endpointError,
    endpointLastUsedAt: row.endpointLastUsedAt?.toISOString() ?? null,
    priceInputMicros: row.priceInputMicros,
    priceOutputMicros: row.priceOutputMicros,
    pricePerRequestMicros: row.pricePerRequestMicros,
    totalRequests: row.totalRequests,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

const updateSchema = modelMetadataSchema.extend({
  slug: z.string().trim().regex(SLUG_PATTERN),
  config: z.unknown(),
  pricing: modelPricingSchema,
});

const publishSchema = z.object({ visibility: z.enum(["public", "private"]) });
const deploySchema = z.object({ fineTuneId: z.string().min(1).max(191) });

const models = new Hono<ApiEnv>();

models.use("/models", requireUser());
models.use("/models/*", requireUser());

async function slugTaken(env: AppEnv, slug: string, exceptId?: string) {
  const conditions = [eq(aiModel.slug, slug)];
  if (exceptId) conditions.push(ne(aiModel.id, exceptId));
  const [row] = await getDb(env)
    .select({ id: aiModel.id })
    .from(aiModel)
    .where(and(...conditions))
    .limit(1);
  return Boolean(row);
}

async function uniqueSlug(env: AppEnv, name: string) {
  const base = toModelSlug(name) || "model";
  const padded = base.length < 3 ? `${base}-model` : base;
  if (!(await slugTaken(env, padded))) return padded;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${padded}-${Math.random().toString(36).slice(2, 7)}`;
    if (!(await slugTaken(env, candidate))) return candidate;
  }
  return `${padded}-${crypto.randomUUID().slice(0, 8)}`;
}

models.get("/models", async (c) => {
  const userId = currentUser(c).id;
  const pageSize = pageSizeOf(c.req.query("pageSize"));
  const conditions = [eq(aiModel.userId, userId)];
  const boundary = cursorCondition(c.req.query("cursor"), aiModel.updatedAt, aiModel.id);
  if (boundary) conditions.push(boundary);
  const rows = await getDb(c.env)
    .select()
    .from(aiModel)
    .where(and(...conditions))
    .orderBy(desc(aiModel.updatedAt), desc(aiModel.id))
    .limit(pageSize + 1);
  const page = rows.slice(0, pageSize);
  const last = page.at(-1);
  return c.json({
    items: page.map(toModelDto),
    nextCursor:
      rows.length > pageSize && last ? encodeCursor(last.updatedAt, last.id) : null,
  });
});

models.post("/models", async (c) => {
  const userId = currentUser(c).id;
  const input = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json(message(c, "server.models.invalidInput"), 400);
  const now = new Date();
  const row: ModelRow = {
    id: crypto.randomUUID(),
    userId,
    slug: await uniqueSlug(c.env, input.data.name),
    name: input.data.name,
    tagline: "",
    description: "",
    category: "text",
    tags: "[]",
    config: JSON.stringify(defaultModelConfig()),
    visibility: "private",
    status: "draft",
    baseModelId: null,
    adapterUri: null,
    fineTuneId: null,
    endpointId: null,
    endpointStatus: "none",
    endpointUrl: null,
    endpointToken: null,
    endpointMicrosPerHour: 0,
    endpointError: null,
    endpointLastUsedAt: null,
    endpointMeteredAt: null,
    endpointHeldMicros: 0,
    priceInputMicros: 0,
    priceOutputMicros: 0,
    pricePerRequestMicros: 0,
    totalRequests: 0,
    avgCostMicros: null,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await getDb(c.env).insert(aiModel).values(row);
  return c.json(toModelDto(row), 201);
});

models.get("/models/:modelId", async (c) => {
  const row = await loadOwnModel(c.env, currentUser(c).id, c.req.param("modelId"));
  if (!row) return c.json(message(c, "server.models.notFound"), 404);
  return c.json(toModelDto(row));
});

models.put("/models/:modelId", async (c) => {
  const userId = currentUser(c).id;
  const row = await loadOwnModel(c.env, userId, c.req.param("modelId"));
  if (!row) return c.json(message(c, "server.models.notFound"), 404);
  const input = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json(message(c, "server.models.invalidInput"), 400);
  const config = modelConfigSchema.safeParse(input.data.config);
  if (!config.success) return c.json(message(c, "server.models.invalidConfig"), 400);
  if (await slugTaken(c.env, input.data.slug, row.id)) {
    return c.json(message(c, "server.models.slugTaken"), 409);
  }
  await getDb(c.env)
    .update(aiModel)
    .set({
      slug: input.data.slug,
      name: input.data.name,
      tagline: input.data.tagline,
      description: input.data.description,
      category: input.data.category,
      tags: JSON.stringify([...new Set(input.data.tags)]),
      config: JSON.stringify(config.data),
      ...input.data.pricing,
      updatedAt: new Date(),
    })
    .where(eq(aiModel.id, row.id));
  const updated = await loadOwnModel(c.env, userId, row.id);
  return c.json(updated ? toModelDto(updated) : { ok: true });
});

models.post("/models/:modelId/publish", async (c) => {
  const userId = currentUser(c).id;
  const row = await loadOwnModel(c.env, userId, c.req.param("modelId"));
  if (!row) return c.json(message(c, "server.models.notFound"), 404);
  const input = publishSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json(message(c, "server.models.invalidInput"), 400);
  if (row.status === "suspended") {
    return c.json(message(c, "server.models.suspended"), 403);
  }
  if (!row.endpointId) return c.json(message(c, "server.models.deployFirst"), 400);
  if (input.data.visibility === "public" && !row.tagline.trim()) {
    return c.json(message(c, "server.models.taglineRequired"), 400);
  }
  const now = new Date();
  await getDb(c.env)
    .update(aiModel)
    .set({
      status: "published",
      visibility: input.data.visibility,
      publishedAt: row.publishedAt ?? now,
      updatedAt: now,
    })
    .where(eq(aiModel.id, row.id));
  return c.json({ ok: true });
});

models.post("/models/:modelId/unpublish", async (c) => {
  const userId = currentUser(c).id;
  const row = await loadOwnModel(c.env, userId, c.req.param("modelId"));
  if (!row) return c.json(message(c, "server.models.notFound"), 404);
  if (row.status === "suspended") {
    return c.json(message(c, "server.models.suspended"), 403);
  }
  await getDb(c.env)
    .update(aiModel)
    .set({ status: "draft", updatedAt: new Date() })
    .where(eq(aiModel.id, row.id));
  return c.json({ ok: true });
});

/* ---------------------------------------------------------------- Nebius のエンドポイント */

models.post("/models/:modelId/deploy", async (c) => {
  const userId = currentUser(c).id;
  const row = await loadOwnModel(c.env, userId, c.req.param("modelId"));
  if (!row) return c.json(message(c, "server.models.notFound"), 404);
  const input = deploySchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json(message(c, "server.models.invalidInput"), 400);
  const [job] = await getDb(c.env)
    .select()
    .from(fineTune)
    .where(
      and(
        eq(fineTune.id, input.data.fineTuneId),
        eq(fineTune.modelId, row.id),
        eq(fineTune.userId, userId),
      ),
    )
    .limit(1);
  if (!job) return c.json(message(c, "server.fineTunes.notFound"), 404);
  // deploying は deployEndpoint が確かめる (途中で落ちて残った行は引き継ぐ)
  if (row.endpointStatus === "starting" || row.endpointStatus === "stopping") {
    return c.json(message(c, "server.endpoints.busy"), 409);
  }

  const result = await deployEndpoint(computeDeps(c.env), row, job);
  if (!result.ok) {
    if (result.reason === "busy") {
      return c.json(message(c, "server.endpoints.busy"), 409);
    }
    if (result.reason === "not_ready") {
      return c.json(message(c, "server.endpoints.trainingNotReady"), 400);
    }
    if (result.reason === "insufficient_credits") {
      return c.json(
        message(c, "server.endpoints.insufficientCredits", {
          amount: Math.ceil((result.holdMicros ?? 0) / 1_000_000),
        }),
        402,
      );
    }
    return c.json(message(c, "server.endpoints.deployFailed"), 502);
  }
  return c.json(toModelDto(result.model));
});

models.get("/models/:modelId/endpoint", async (c) => {
  const row = await loadOwnModel(c.env, currentUser(c).id, c.req.param("modelId"));
  if (!row) return c.json(message(c, "server.models.notFound"), 404);
  const refreshed = await refreshEndpoint(computeDeps(c.env), row);
  return c.json(toModelDto(refreshed));
});

models.post("/models/:modelId/endpoint/start", async (c) => {
  const userId = currentUser(c).id;
  const row = await loadOwnModel(c.env, userId, c.req.param("modelId"));
  if (!row) return c.json(message(c, "server.models.notFound"), 404);
  if (!row.endpointId) return c.json(message(c, "server.models.deployFirst"), 400);
  const result = await wakeEndpoint(computeDeps(c.env), row);
  if (result.state === "insufficient_credits") {
    return c.json(
      message(c, "server.endpoints.insufficientCredits", {
        amount: Math.ceil(result.holdMicros / 1_000_000),
      }),
      402,
    );
  }
  if (result.state === "failed") {
    return c.json(message(c, "server.endpoints.startFailed"), 502);
  }
  return c.json(toModelDto(result.model));
});

models.post("/models/:modelId/endpoint/stop", async (c) => {
  const userId = currentUser(c).id;
  const row = await loadOwnModel(c.env, userId, c.req.param("modelId"));
  if (!row) return c.json(message(c, "server.models.notFound"), 404);
  const stopped = await stopEndpointFor(computeDeps(c.env), row);
  return c.json(toModelDto(stopped));
});

models.delete("/models/:modelId/deploy", async (c) => {
  const userId = currentUser(c).id;
  const row = await loadOwnModel(c.env, userId, c.req.param("modelId"));
  if (!row) return c.json(message(c, "server.models.notFound"), 404);
  if (!row.endpointId) return c.json({ ok: true });
  await removeEndpoint(computeDeps(c.env), row);
  // エンドポイントが無いと呼び出せないので非公開に戻す
  await getDb(c.env)
    .update(aiModel)
    .set({ status: row.status === "published" ? "draft" : row.status, updatedAt: new Date() })
    .where(eq(aiModel.id, row.id));
  return c.json({ ok: true });
});

/* ---------------------------------------------------------------- 統計・削除 */

models.get("/models/:modelId/stats", async (c) => {
  const modelId = c.req.param("modelId");
  const row = await loadOwnModel(c.env, currentUser(c).id, modelId);
  if (!row) return c.json(message(c, "server.models.notFound"), 404);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const days = await getDb(c.env)
    .select({
      day: sql<string>`date_format(${usageRecord.createdAt}, '%Y-%m-%d')`,
      requests: sql<string>`count(*)`,
      failures: sql<string>`sum(case when ${usageRecord.status} = 'failed' then 1 else 0 end)`,
      creatorMicros: sql<string>`coalesce(sum(${usageRecord.creatorMicros}), 0)`,
      inputTokens: sql<string>`coalesce(sum(${usageRecord.inputTokens}), 0)`,
      outputTokens: sql<string>`coalesce(sum(${usageRecord.outputTokens}), 0)`,
      avgLatencyMs: sql<string>`coalesce(avg(${usageRecord.latencyMs}), 0)`,
    })
    .from(usageRecord)
    .where(and(eq(usageRecord.modelId, modelId), gte(usageRecord.createdAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return c.json({
    days: days.map((day) => ({
      day: day.day,
      requests: Number(day.requests),
      failures: Number(day.failures),
      creatorMicros: Number(day.creatorMicros),
      inputTokens: Number(day.inputTokens),
      outputTokens: Number(day.outputTokens),
      avgLatencyMs: Math.round(Number(day.avgLatencyMs)),
    })),
  });
});

models.delete("/models/:modelId", async (c) => {
  const userId = currentUser(c).id;
  const row = await loadOwnModel(c.env, userId, c.req.param("modelId"));
  if (!row) return c.json({ ok: true });
  const deps = computeDeps(c.env);
  // 動いている学習とエンドポイントを止めてから消す (使った分は精算する)
  const active = await getDb(c.env)
    .select()
    .from(fineTune)
    .where(
      and(
        eq(fineTune.modelId, row.id),
        inArray(fineTune.status, [...ACTIVE_FINE_TUNE_STATUSES]),
      ),
    );
  for (const job of active) await cancelFineTune(deps, job);
  if (row.endpointId) await removeEndpoint(deps, row);
  await getDb(c.env).delete(aiModel).where(eq(aiModel.id, row.id));
  return c.json({ ok: true });
});

export default models;
