import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { fineTune } from "@/lib/db/schema";
import { listNemotronBaseModels } from "@/lib/nebius";
import { recordAuditLog } from "@/lib/organization/audit";
import { endpointIdleMinutes } from "@/lib/billing/compute";
import {
  DATASET_MAX_BYTES,
  EVAL_SET_MAX_BYTES,
  hyperparametersSchema,
} from "@/lib/models/dataset";
import { BUILDER_ROLE_MAX_CHARS } from "@/lib/nemotron/dataset-builder";
import { computeDeps } from "@/lib/compute/deps";
import {
  cancelFineTune,
  isActiveFineTune,
  refreshFineTune,
  startFineTune,
} from "@/lib/compute/fine-tune";
import { ratesFor, type FineTuneRow } from "@/lib/compute/types";
import { organizationAuth } from "./access";
import { actorOf, loadOrgModel, message } from "./shared";
import type { ApiEnv } from "../types";

export function toFineTuneDto(row: FineTuneRow) {
  let hyperparameters: unknown;
  try {
    hyperparameters = JSON.parse(row.hyperparameters);
  } catch {
    hyperparameters = {};
  }
  return {
    id: row.id,
    modelId: row.modelId,
    baseModelId: row.baseModelId,
    datasetName: row.datasetName,
    datasetBytes: row.datasetBytes,
    datasetExamples: row.datasetExamples,
    datasetSource: row.datasetSource,
    evalExamples: row.evalExamples,
    hyperparameters,
    status: row.status,
    adapterUri: row.adapterUri,
    error: row.error,
    estimatedMicros: row.estimatedMicros,
    heldMicros: row.heldMicros,
    costMicros: row.costMicros,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

const startSchema = z.object({
  baseModelId: z.string().min(1).max(191),
  datasetName: z.string().trim().min(1).max(255),
  jsonl: z.string().min(1),
  hyperparameters: hyperparametersSchema,
  /** 評価用に取っておいた例 (JSONL)。学習には使わない */
  evalJsonl: z.string().max(EVAL_SET_MAX_BYTES).nullish(),
  datasetSource: z.enum(["upload", "builder"]).optional(),
  datasetRole: z.string().max(BUILDER_ROLE_MAX_CHARS).nullish(),
});

/** JSON に包んだ JSONL を受け取るので、本文は学習データの上限より少し大きくてよい */
const MAX_BODY_BYTES = Math.ceil((DATASET_MAX_BYTES + EVAL_SET_MAX_BYTES) * 1.2) + 64 * 1024;

const fineTunes = new Hono<ApiEnv>();

fineTunes.use("/:organizationId/base-models", organizationAuth());
fineTunes.use("/:organizationId/fine-tunes/*", organizationAuth());
fineTunes.use("/:organizationId/models/:modelId/fine-tunes", organizationAuth());

/** 微調整できる Nemotron と、その GPU の1時間あたりの料金 (上乗せ込み) */
fineTunes.get("/:organizationId/base-models", (c) => {
  const items = listNemotronBaseModels().map((base) => ({
    id: base.id,
    label: base.label,
    trainPreset: base.trainPreset,
    servePreset: base.servePreset,
    ...ratesFor(base),
  }));
  return c.json({ items, idleMinutes: endpointIdleMinutes(c.env) });
});

fineTunes.get("/:organizationId/models/:modelId/fine-tunes", async (c) => {
  const organizationId = c.req.param("organizationId");
  const model = await loadOrgModel(c.env, organizationId, c.req.param("modelId"));
  if (!model) return c.json(message(c, "server.models.notFound"), 404);
  const rows = await getDb(c.env)
    .select()
    .from(fineTune)
    .where(and(eq(fineTune.organizationId, organizationId), eq(fineTune.modelId, model.id)))
    .orderBy(desc(fineTune.createdAt))
    .limit(50);
  // 画面を開いたときにも進み具合を確かめる (見回りを待たずに済むように)
  const deps = computeDeps(c.env);
  const items = await Promise.all(
    rows.map((row) => (isActiveFineTune(row.status) ? refreshFineTune(deps, row) : row)),
  );
  return c.json({ items: items.map(toFineTuneDto) });
});

fineTunes.post("/:organizationId/models/:modelId/fine-tunes", async (c) => {
  const organizationId = c.req.param("organizationId");
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return c.json(
      message(c, "server.fineTunes.datasetTooLarge", {
        mb: Math.round(DATASET_MAX_BYTES / 1024 / 1024),
      }),
      413,
    );
  }
  const model = await loadOrgModel(c.env, organizationId, c.req.param("modelId"));
  if (!model) return c.json(message(c, "server.models.notFound"), 404);
  const input = startSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json(message(c, "server.fineTunes.invalidInput"), 400);
  const baseModel = listNemotronBaseModels().find(
    (candidate) => candidate.id === input.data.baseModelId,
  );
  if (!baseModel) return c.json(message(c, "server.fineTunes.unknownBaseModel"), 400);

  // 先に確かめるのは早く断るため。同時に始めたときは activeKey の一意の索引で1つだけ通る (startFineTune)
  const [running] = await getDb(c.env)
    .select({ id: fineTune.id, status: fineTune.status })
    .from(fineTune)
    .where(eq(fineTune.modelId, model.id))
    .orderBy(desc(fineTune.createdAt))
    .limit(1);
  if (running && isActiveFineTune(running.status)) {
    return c.json(message(c, "server.fineTunes.alreadyRunning"), 409);
  }

  const actor = actorOf(c);
  const result = await startFineTune(computeDeps(c.env), {
    organizationId,
    modelId: model.id,
    createdBy: actor.id,
    baseModel,
    datasetName: input.data.datasetName,
    jsonl: input.data.jsonl,
    hyperparameters: input.data.hyperparameters,
    evalJsonl: input.data.evalJsonl ?? null,
    datasetSource: input.data.datasetSource,
    datasetRole: input.data.datasetRole ?? null,
  });
  if (!result.ok) {
    if (result.reason === "invalid_dataset" || result.reason === "invalid_eval_set") {
      return c.json(
        {
          ...message(
            c,
            result.reason === "invalid_dataset"
              ? "server.fineTunes.invalidDataset"
              : "server.fineTunes.invalidEvalSet",
          ),
          issues: result.issues,
        },
        400,
      );
    }
    if (result.reason === "already_running") {
      return c.json(message(c, "server.fineTunes.alreadyRunning"), 409);
    }
    if (result.reason === "insufficient_credits") {
      return c.json(
        message(c, "server.fineTunes.insufficientCredits", {
          amount: Math.ceil(result.holdMicros / 1_000_000),
        }),
        402,
      );
    }
    return c.json(
      { ...message(c, "server.fineTunes.startFailed"), fineTune: toFineTuneDto(result.row) },
      502,
    );
  }
  await recordAuditLog(c.env, {
    organizationId,
    actor,
    action: "fine_tune.start",
    targetId: result.row.id,
    targetLabel: model.name,
    metadata: {
      modelId: model.id,
      baseModelId: baseModel.id,
      examples: result.row.datasetExamples,
      evalExamples: result.row.evalExamples,
      datasetSource: result.row.datasetSource,
      estimatedMicros: result.row.estimatedMicros,
    },
  });
  return c.json(toFineTuneDto(result.row), 201);
});

async function loadFineTune(env: CloudflareEnv, organizationId: string, id: string) {
  const [row] = await getDb(env)
    .select()
    .from(fineTune)
    .where(and(eq(fineTune.organizationId, organizationId), eq(fineTune.id, id)))
    .limit(1);
  return row ?? null;
}

fineTunes.get("/:organizationId/fine-tunes/:fineTuneId", async (c) => {
  const row = await loadFineTune(
    c.env,
    c.req.param("organizationId"),
    c.req.param("fineTuneId"),
  );
  if (!row) return c.json(message(c, "server.fineTunes.notFound"), 404);
  const refreshed = await refreshFineTune(computeDeps(c.env), row);
  return c.json(toFineTuneDto(refreshed));
});

fineTunes.post("/:organizationId/fine-tunes/:fineTuneId/cancel", async (c) => {
  const organizationId = c.req.param("organizationId");
  const row = await loadFineTune(c.env, organizationId, c.req.param("fineTuneId"));
  if (!row) return c.json(message(c, "server.fineTunes.notFound"), 404);
  const canceled = await cancelFineTune(computeDeps(c.env), row);
  if (canceled.status !== row.status) {
    await recordAuditLog(c.env, {
      organizationId,
      actor: actorOf(c),
      action: "fine_tune.cancel",
      targetId: row.id,
      targetLabel: row.datasetName,
      metadata: { modelId: row.modelId, costMicros: canceled.costMicros },
    });
  }
  return c.json(toFineTuneDto(canceled));
});

export default fineTunes;
