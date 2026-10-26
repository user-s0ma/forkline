import { and, eq, inArray } from "drizzle-orm";
import { applyLedgerEntry } from "../billing/wallet";
import { yenToMicros } from "../billing/pricing";
import { getDb } from "../db/client";
import { aiModel, evalItem, evalRun, fineTune } from "../db/schema";

/**
 * お試しの共有アカウント。パスワードを持たず、/api/auth/sign-in/demo からだけ入れる。
 * 学習済みのモデルを1つ持ち、見ること・載せること・プレイグラウンドで試すことだけができる
 */
export const DEMO_EMAIL = "demo@forkline.invalid";
export const DEMO_NAME = "Forkline Demo";

export function isDemoUser(user: { email: string }) {
  return user.email === DEMO_EMAIL;
}

/** お試しでも使える、書き込みの API (それ以外の書き込みは止める) */
const DEMO_WRITE_PATHS = [
  /^\/api\/models\/[^/]+\/deploy$/,
  /^\/api\/models\/[^/]+\/endpoint\/(start|stop)$/,
  /^\/api\/playground\/chat$/,
];

export function demoMayWrite(method: string, path: string) {
  return method === "POST" && DEMO_WRITE_PATHS.some((pattern) => pattern.test(path));
}

/**
 * お試しのアカウントに、元のモデル (DEMO_SOURCE_MODEL_ID) の写しと、GPU を動かすためのクレジットを用意する。
 * 写すのは、モデル・それを作った学習・その学習の評価。LoRA のアダプターは元のものを共有する (読むだけ)。
 * もう写してあれば何もしない
 */
export async function prepareDemoAccount(env: AppEnv, demoUserId: string) {
  const db = getDb(env);
  const [existing] = await db.select({ id: aiModel.id }).from(aiModel).where(eq(aiModel.userId, demoUserId)).limit(1);
  if (!existing) {
    const [source] = await db.select().from(aiModel).where(eq(aiModel.id, env.DEMO_SOURCE_MODEL_ID)).limit(1);
    if (!source?.fineTuneId) throw new Error(`お試しに写すモデル ${env.DEMO_SOURCE_MODEL_ID} が無いか、学習が済んでいません`);
    const [training] = await db.select().from(fineTune).where(eq(fineTune.id, source.fineTuneId)).limit(1);
    if (!training) throw new Error(`学習 ${source.fineTuneId} が見つかりません`);
    const runs = await db
      .select()
      .from(evalRun)
      .where(and(eq(evalRun.modelId, source.id), eq(evalRun.fineTuneId, training.id), eq(evalRun.status, "succeeded")));
    const items = runs.length ? await db.select().from(evalItem).where(inArray(evalItem.runId, runs.map((r) => r.id))) : [];

    const modelId = crypto.randomUUID();
    const fineTuneId = crypto.randomUUID();
    const runIds = new Map(runs.map((r) => [r.id, crypto.randomUUID()]));
    await db.transaction(async (tx) => {
      await tx.insert(aiModel).values({
        ...source,
        id: modelId,
        userId: demoUserId,
        slug: `${source.slug.slice(0, 58)}-demo`,
        fineTuneId,
        // 公開のページや一覧には出さない (自分のモデルとしてプレイグラウンドで試せる)
        visibility: "private",
        endpointId: null,
        endpointStatus: "none",
        endpointUrl: null,
        endpointToken: null,
        endpointError: null,
        endpointLastUsedAt: null,
        endpointMeteredAt: null,
        endpointHeldMicros: 0,
        totalRequests: 0,
        avgCostMicros: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await tx.insert(fineTune).values({ ...training, id: fineTuneId, userId: demoUserId, modelId, activeKey: null, heldMicros: 0 });
      for (const run of runs) {
        await tx.insert(evalRun).values({ ...run, id: runIds.get(run.id)!, userId: demoUserId, modelId, fineTuneId });
      }
      for (const item of items) {
        await tx.insert(evalItem).values({ ...item, id: crypto.randomUUID(), runId: runIds.get(item.runId)! });
      }
    });
  }

  // GPU を動かすクレジット。一度だけ入れる (referenceId で重複を防ぐ)
  await applyLedgerEntry(env, {
    userId: demoUserId,
    kind: "adjustment",
    balance: "credit",
    amountMicros: yenToMicros(Number(env.DEMO_CREDIT_YEN)),
    referenceId: "demo-account-credit",
    description: "Demo account credit",
  });
}
