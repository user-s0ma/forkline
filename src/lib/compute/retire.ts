import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { aiModel, apiKey, fineTune } from "../db/schema";
import { computeDeps } from "./deps";
import { removeEndpoint } from "./endpoint";
import { ACTIVE_FINE_TUNE_STATUSES, cancelFineTune } from "./fine-tune";

/**
 * アカウントを消すときに、その人の学習とエンドポイントを止めて (使った分は精算する)、モデルを非公開にし、
 * API キーを無効にする。
 * GPU が動き続けたり、消えた人のモデルがストアに残ったりしないように。
 */
export async function retireUserModels(env: AppEnv, userId: string) {
  const db = getDb(env);
  const deps = computeDeps(env);
  const jobs = await db
    .select()
    .from(fineTune)
    .where(
      and(
        eq(fineTune.userId, userId),
        inArray(fineTune.status, [...ACTIVE_FINE_TUNE_STATUSES]),
      ),
    );
  for (const job of jobs) {
    await cancelFineTune(deps, job).catch((error) =>
      console.error("アカウントの削除で学習を止められませんでした:", job.id, error),
    );
  }
  const models = await db.select().from(aiModel).where(eq(aiModel.userId, userId));
  for (const model of models) {
    if (model.endpointId) {
      await removeEndpoint(deps, model).catch((error) =>
        console.error("アカウントの削除でエンドポイントを消せませんでした:", model.id, error),
      );
    }
  }
  await db
    .update(aiModel)
    .set({ status: "draft", updatedAt: new Date() })
    .where(eq(aiModel.userId, userId));
  await db
    .update(apiKey)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKey.userId, userId), isNull(apiKey.revokedAt)));
}
