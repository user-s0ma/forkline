import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { aiModel, apiKey, fineTune } from "../db/schema";
import { computeDeps } from "./deps";
import { removeEndpoint } from "./endpoint";
import { ACTIVE_FINE_TUNE_STATUSES, cancelFineTune } from "./fine-tune";

/**
 * 組織を消すときに、その組織の学習とエンドポイントを止めて (使った分は精算する)、モデルを非公開にし、
 * API キーを無効にする。
 * GPU が動き続けたり、消えた組織のモデルがストアに残ったりしないように。
 */
export async function retireOrganizationModels(env: CloudflareEnv, organizationId: string) {
  const db = getDb(env);
  const deps = computeDeps(env);
  const jobs = await db
    .select()
    .from(fineTune)
    .where(
      and(
        eq(fineTune.organizationId, organizationId),
        inArray(fineTune.status, [...ACTIVE_FINE_TUNE_STATUSES]),
      ),
    );
  for (const job of jobs) {
    await cancelFineTune(deps, job).catch((error) =>
      console.error("組織の削除で学習を止められませんでした:", job.id, error),
    );
  }
  const models = await db.select().from(aiModel).where(eq(aiModel.organizationId, organizationId));
  for (const model of models) {
    if (model.endpointId) {
      await removeEndpoint(deps, model).catch((error) =>
        console.error("組織の削除でエンドポイントを消せませんでした:", model.id, error),
      );
    }
  }
  await db
    .update(aiModel)
    .set({ status: "draft", updatedAt: new Date() })
    .where(eq(aiModel.organizationId, organizationId));
  await db
    .update(apiKey)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKey.organizationId, organizationId), isNull(apiKey.revokedAt)));
}
