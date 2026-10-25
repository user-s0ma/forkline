import { and, desc, eq, like, or, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, containsPattern } from "@/lib/db/client";
import { aiModel, organization } from "@/lib/db/schema";
import { detectLocale, translate } from "@/lib/i18n";
import { listNemotronBaseModels } from "@/lib/nebius";
import { parseTags } from "@/lib/models/config";
import { MODEL_CATEGORIES } from "@/lib/billing/pricing";
import { latestEvaluationFor } from "@/lib/nemotron/deps";
import type { ApiEnv } from "./types";

const PAGE_SIZE = 24;

const store = new Hono<ApiEnv>();

function baseModelLabel(baseModelId: string | null) {
  if (!baseModelId) return null;
  try {
    return (
      listNemotronBaseModels().find((base) => base.id === baseModelId)?.label ??
      baseModelId
    );
  } catch {
    return baseModelId;
  }
}

/** 利用者が払う単価 (クリエイター価格)。GPU 代は公開した組織が払うので含めない。設定の中身は出さない */
function toListing(row: typeof aiModel.$inferSelect, publisherName: string | null) {
  return {
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    category: row.category,
    tags: parseTags(row.tags),
    baseModel: baseModelLabel(row.baseModelId),
    publisherName: publisherName ?? "",
    totalRequests: row.totalRequests,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    pricing: {
      priceInputMicros: row.priceInputMicros,
      priceOutputMicros: row.priceOutputMicros,
      pricePerRequestMicros: row.pricePerRequestMicros,
    },
  };
}

const listed = and(eq(aiModel.status, "published"), eq(aiModel.visibility, "public"));

store.get("/models", async (c) => {
  const query = (c.req.query("q") || "").trim().slice(0, 100);
  const category = c.req.query("category") || "";
  const sort = c.req.query("sort") === "new" ? "new" : "popular";
  const page = Math.max(0, Number.parseInt(c.req.query("page") || "0", 10) || 0);

  const conditions: (SQL | undefined)[] = [listed];
  if ((MODEL_CATEGORIES as readonly string[]).includes(category)) {
    conditions.push(eq(aiModel.category, category));
  }
  if (query) {
    const pattern = containsPattern(query);
    conditions.push(
      or(
        like(aiModel.name, pattern),
        like(aiModel.tagline, pattern),
        like(aiModel.slug, pattern),
        like(aiModel.tags, pattern),
      ),
    );
  }
  const db = getDb(c.env);
  const where = and(...conditions);
  const [rows, total] = await Promise.all([
    db
      .select({ model: aiModel, publisherName: organization.name })
      .from(aiModel)
      .leftJoin(organization, eq(organization.id, aiModel.organizationId))
      .where(where)
      .orderBy(
        ...(sort === "new"
          ? [desc(aiModel.publishedAt), desc(aiModel.id)]
          : [desc(aiModel.totalRequests), desc(aiModel.publishedAt), desc(aiModel.id)]),
      )
      .limit(PAGE_SIZE)
      .offset(page * PAGE_SIZE),
    // ページ番号を出すために、同じ条件での総件数も返す
    db.$count(aiModel, where),
  ]);
  c.header("Cache-Control", "public, max-age=30");
  return c.json({
    items: rows.map((row) => toListing(row.model, row.publisherName)),
    page,
    pageSize: PAGE_SIZE,
    total,
    nextPage: (page + 1) * PAGE_SIZE < total ? page + 1 : null,
  });
});

/** ストアに公開中のモデルを slug で探す (詳細ページ・OG 画像で共通) */
export async function findPublicModel(env: AppEnv, slug: string) {
  const [row] = await getDb(env)
    .select({ model: aiModel, publisherName: organization.name })
    .from(aiModel)
    .leftJoin(organization, eq(organization.id, aiModel.organizationId))
    .where(and(eq(aiModel.slug, slug), listed))
    .limit(1);
  return row ?? null;
}

store.get("/models/:slug", async (c) => {
  const row = await findPublicModel(c.env, c.req.param("slug"));
  if (!row) {
    return c.json(
      { message: translate(detectLocale(c.req.raw), "server.models.notFound") },
      404,
    );
  }
  // いま載せている LoRA の評価だけを出す (前の LoRA の評価は今のモデルの数字ではないため)
  const evaluation = row.model.fineTuneId
    ? await latestEvaluationFor(c.env, row.model.id, row.model.fineTuneId)
    : null;
  return c.json({
    ...toListing(row.model, row.publisherName),
    description: row.model.description,
    evaluation: evaluation
      ? {
          n: evaluation.summary.n,
          fineTunedMean: evaluation.summary.fineTunedMean,
          baseMean: evaluation.summary.baseMean,
          wins: evaluation.summary.wins,
          ties: evaluation.summary.ties,
          losses: evaluation.summary.losses,
          winRate: evaluation.summary.winRate,
          signTestP: evaluation.summary.signTestP,
          interval: evaluation.summary.interval,
          verdict: evaluation.summary.verdict,
          baselineModel: evaluation.baselineModel,
          judgeModel: evaluation.judgeModel,
          completedAt: evaluation.completedAt,
        }
      : null,
    // 成功した実行で実際に請求した額の平均 (直近およそ100回の指数移動平均)
    averageCostMicros: row.model.avgCostMicros,
    // 止まっていれば、最初の呼び出しで起動を待つことになる
    warm: row.model.endpointStatus === "running",
  });
});

export default store;
