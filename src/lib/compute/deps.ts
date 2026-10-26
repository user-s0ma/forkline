import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import * as nebius from "../nebius";
import { getDb, type Database } from "../db/client";
import { aiModel, fineTune } from "../db/schema";
import {
  getCreditMicros,
  isDuplicateKeyError,
  releaseCredit,
  reserveCredit,
  settleHold,
  affectedRows,
  writeHoldSettlement,
} from "../billing/wallet";
import {
  decryptSecretValue,
  encryptSecretValue,
} from "../util/secret-box";
import type { ComputeDeps } from "./types";

/** 本番の Nebius・残高・DB をつないだ ComputeDeps */
export function computeDeps(env: AppEnv): ComputeDeps {
  const db = getDb(env);
  return {
    env,
    nebius,
    now: () => new Date(),
    tokens: {
      seal: (value) => encryptSecretValue(value, env.SECRET_ENCRYPTION_KEY),
      open: (sealed) => decryptSecretValue(sealed, env.SECRET_ENCRYPTION_KEY),
    },
    credits: {
      reserve: (userId, micros) => reserveCredit(env, userId, micros),
      release: (userId, micros) => releaseCredit(env, userId, micros),
      settle: (input) => settleHold(env, input),
      balance: (userId) => getCreditMicros(env, userId),
    },
    fineTunes: {
      async insert(row) {
        await db.insert(fineTune).values(row);
      },
      async update(id, patch, onlyIfStatus) {
        const conditions: SQL[] = [eq(fineTune.id, id)];
        if (onlyIfStatus) conditions.push(inArray(fineTune.status, [...onlyIfStatus]));
        const result = await db
          .update(fineTune)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(...conditions));
        return affectedRows(result) > 0;
      },
    },
    models: {
      async get(id) {
        const [row] = await db.select().from(aiModel).where(eq(aiModel.id, id)).limit(1);
        return row ?? null;
      },
      async meter(id, since, now, settlement) {
        const advance = (tx: Database) =>
          tx
            .update(aiModel)
            .set({ endpointMeteredAt: now, updatedAt: sql`${aiModel.updatedAt}` })
            .where(and(eq(aiModel.id, id), eq(aiModel.endpointMeteredAt, since)));
        try {
          // 起点を進めるのと台帳に書くのを1つのトランザクションにする (片方だけ済むことが無いように)
          return await db.transaction(async (tx) => {
            if (!affectedRows(await advance(tx as unknown as Database))) return false;
            await writeHoldSettlement(tx as unknown as Database, settlement);
            return true;
          });
        } catch (error) {
          // この区間はもう台帳にある (前の版で起点を進めそこねた) ときは、起点だけ進める
          if (isDuplicateKeyError(error)) return affectedRows(await advance(db)) > 0;
          throw error;
        }
      },
      async update(id, patch, onlyIf) {
        const conditions: SQL[] = [eq(aiModel.id, id)];
        if (onlyIf?.endpointStatus) {
          conditions.push(inArray(aiModel.endpointStatus, [...onlyIf.endpointStatus]));
        }
        if (onlyIf && "endpointMeteredAt" in onlyIf) {
          conditions.push(
            onlyIf.endpointMeteredAt === null
              ? isNull(aiModel.endpointMeteredAt)
              : eq(aiModel.endpointMeteredAt, onlyIf.endpointMeteredAt!),
          );
        }
        if (onlyIf?.endpointHeldMicros !== undefined) {
          conditions.push(eq(aiModel.endpointHeldMicros, onlyIf.endpointHeldMicros));
        }
        // エンドポイントの状態が変わっただけでは、モデルの更新日時 (一覧の並び順) を動かさない
        const result = await db
          .update(aiModel)
          .set({ updatedAt: sql`${aiModel.updatedAt}`, ...patch })
          .where(and(...conditions));
        return affectedRows(result) > 0;
      },
    },
  };
}
