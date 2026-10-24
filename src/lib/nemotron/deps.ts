import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { evalItem, evalRun } from "../db/schema";
import { DEFAULT_TOKEN_FACTORY_MODEL, tokenFactoryChat } from "../nebius";
import { affectedRows } from "../billing/wallet";
import { computeDeps } from "../compute/deps";
import type { NemotronDeps } from "./charge";
import { readSummary } from "./evaluation";
import { EVAL_CLAIM_TIMEOUT_MS, type EvalItemRow, type EvalStore } from "./run-evaluation";

/** 本番の Token Factory と残高をつないだ NemotronDeps */
export function nemotronDeps(env: CloudflareEnv): NemotronDeps {
  return {
    env,
    chat: tokenFactoryChat,
    model: DEFAULT_TOKEN_FACTORY_MODEL,
    credits: computeDeps(env).credits,
  };
}

/** 評価の問題を DB に置く EvalStore */
export function evalStore(env: CloudflareEnv): EvalStore {
  const db = getDb(env);
  return {
    async claim(runId, limit, now) {
      const stale = new Date(now.getTime() - EVAL_CLAIM_TIMEOUT_MS);
      const candidates = await db
        .select()
        .from(evalItem)
        .where(
          and(
            eq(evalItem.runId, runId),
            or(
              eq(evalItem.status, "pending"),
              and(eq(evalItem.status, "running"), lt(evalItem.claimedAt, stale)),
            ),
          ),
        )
        .orderBy(asc(evalItem.position))
        .limit(limit);
      const claimed: EvalItemRow[] = [];
      for (const candidate of candidates) {
        // 同時に別の step が取っていれば、状態か回数が変わっているので更新できない
        const result = await db
          .update(evalItem)
          .set({ status: "running", claimedAt: now, attempts: candidate.attempts + 1 })
          .where(
            and(
              eq(evalItem.id, candidate.id),
              eq(evalItem.status, candidate.status),
              eq(evalItem.attempts, candidate.attempts),
            ),
          );
        if (affectedRows(result) > 0) {
          claimed.push({
            ...candidate,
            status: "running",
            claimedAt: now,
            attempts: candidate.attempts + 1,
          });
        }
      }
      return claimed;
    },
    async save(id, patch) {
      await db.update(evalItem).set(patch).where(eq(evalItem.id, id));
    },
    async remaining(runId) {
      return db.$count(
        evalItem,
        and(eq(evalItem.runId, runId), inArray(evalItem.status, ["pending", "running"])),
      );
    },
    async finished(runId) {
      return db
        .select()
        .from(evalItem)
        .where(and(eq(evalItem.runId, runId), inArray(evalItem.status, ["done", "failed"])))
        .orderBy(asc(evalItem.position));
    },
    async addCost(runId, micros) {
      await db
        .update(evalRun)
        .set({ costMicros: sql`${evalRun.costMicros} + ${Math.max(0, Math.ceil(micros))}` })
        .where(eq(evalRun.id, runId));
    },
    async finishRun(runId, patch) {
      const result = await db
        .update(evalRun)
        .set(patch)
        .where(and(eq(evalRun.id, runId), eq(evalRun.status, "running")));
      return affectedRows(result) > 0;
    },
  };
}

/** その LoRA (学習) の、いちばん新しい成功した評価。ストアとモデルカードの下書きで使う */
export async function latestEvaluationFor(env: CloudflareEnv, modelId: string, fineTuneId: string) {
  const [row] = await getDb(env)
    .select()
    .from(evalRun)
    .where(
      and(
        eq(evalRun.modelId, modelId),
        eq(evalRun.fineTuneId, fineTuneId),
        eq(evalRun.status, "succeeded"),
      ),
    )
    .orderBy(desc(evalRun.completedAt))
    .limit(1);
  const summary = readSummary(row?.summary ?? null);
  if (!row || !summary) return null;
  return {
    summary,
    baselineModel: row.baselineModel,
    judgeModel: row.judgeModel,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
