import { and, desc, eq, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { takeRateLimit } from "./rate-limit";
import { cors } from "hono/cors";
import { bearerToken, hashApiKey, isApiKeyFormat } from "@/lib/billing/api-keys";
import { getDb } from "@/lib/db/client";
import { aiModel, apiKey, user } from "@/lib/db/schema";
import {
  errorResponse,
  GatewayError,
  readChatRequest,
  resolveModel,
  runChat,
} from "./runtime";

type GatewayEnv = {
  Bindings: AppEnv;
  Variables: { userId: string; apiKeyId: string };
};

const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

const gateway = new Hono<GatewayEnv>();

gateway.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["X-Forkline-Cost-JPY", "Retry-After"],
  }),
);

// API キーは利用者のもの。呼び出しの料金はキーの持ち主のクレジットから引き落とす
gateway.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") return next();
  const token = bearerToken(c.req.header("Authorization"));
  if (!token || !isApiKeyFormat(token)) {
    return errorResponse(
      new GatewayError(401, "invalid_api_key", "Missing or invalid API key"),
    );
  }
  const db = getDb(c.env);
  const [record] = await db
    .select({
      id: apiKey.id,
      userId: apiKey.userId,
      lastUsedAt: apiKey.lastUsedAt,
    })
    .from(apiKey)
    .where(and(eq(apiKey.keyHash, await hashApiKey(token)), isNull(apiKey.revokedAt)))
    .limit(1);
  if (!record) {
    return errorResponse(
      new GatewayError(401, "invalid_api_key", "Missing or invalid API key"),
    );
  }

  const success = takeRateLimit(record.id);
  if (!success) {
    return errorResponse(
      new GatewayError(429, "rate_limit_exceeded", "Too many requests"),
    );
  }

  if (
    !record.lastUsedAt ||
    Date.now() - record.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS
  ) {
    c.executionCtx.waitUntil(
      db
        .update(apiKey)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKey.id, record.id))
        .catch((error) => console.error("APIキーの最終利用日時を更新できませんでした:", error)),
    );
  }
  c.set("userId", record.userId);
  c.set("apiKeyId", record.id);
  await next();
});

/** ストアに公開中のモデルと、キーの持ち主自身のモデル */
gateway.get("/v1/models", async (c) => {
  const rows = await getDb(c.env)
    .select({
      slug: aiModel.slug,
      owner: user.name,
      publishedAt: aiModel.publishedAt,
      createdAt: aiModel.createdAt,
    })
    .from(aiModel)
    .leftJoin(user, eq(user.id, aiModel.userId))
    .where(
      or(
        and(eq(aiModel.status, "published"), eq(aiModel.visibility, "public")),
        eq(aiModel.userId, c.get("userId")),
      ),
    )
    .orderBy(desc(aiModel.publishedAt))
    .limit(500);
  return c.json({
    object: "list",
    data: rows.map((row) => ({
      id: row.slug,
      object: "model",
      created: Math.floor((row.publishedAt ?? row.createdAt).getTime() / 1000),
      owned_by: row.owner ?? "forkline",
    })),
  });
});

gateway.post("/v1/chat/completions", async (c) => {
  // 本文は大きさの上限つきで読む (413)
  const request = await readChatRequest(c.req.raw);
  const userId = c.get("userId");
  const { model, config } = await resolveModel(c.env, request.model, userId);
  return runChat(
    {
      env: c.env,
      waitUntil: (promise) => c.executionCtx.waitUntil(promise),
      model,
      config,
      consumerUserId: userId,
      apiKeyId: c.get("apiKeyId"),
      source: "api",
    },
    request,
  );
});

gateway.onError((error) => {
  if (error instanceof GatewayError) return errorResponse(error);
  console.error(error);
  return errorResponse(new GatewayError(500, "internal_error", "Internal error"));
});

gateway.notFound(() =>
  errorResponse(new GatewayError(404, "not_found", "Not found")),
);

export default gateway;
