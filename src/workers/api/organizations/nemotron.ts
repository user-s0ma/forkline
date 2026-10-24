import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { evalItem, evalRun, fineTune } from "@/lib/db/schema";
import { parseModelConfig } from "@/lib/models/config";
import { tokenFactoryHoldMicros } from "@/lib/billing/compute";
import { recordAuditLog } from "@/lib/organization/audit";
import { computeDeps } from "@/lib/compute/deps";
import { errorText, type FineTuneRow, type ModelRow } from "@/lib/compute/types";
import type { ChatMessage } from "@/lib/nebius";
import { InsufficientCreditsError } from "@/lib/nemotron/charge";
import {
  BUILDER_FACTS_PER_CALL,
  BUILDER_MATERIAL_MAX_CHARS,
  BUILDER_ROLE_MAX_CHARS,
  GENERATED_ASSISTANT_MAX_CHARS,
  GENERATED_USER_MAX_CHARS,
} from "@/lib/nemotron/dataset-builder";
import { evalStore, latestEvaluationFor, nemotronDeps } from "@/lib/nemotron/deps";
import {
  EVAL_MAX_ITEMS,
  evalPromptsFromJsonl,
  fineTunedFirstFor,
  readSummary,
} from "@/lib/nemotron/evaluation";
import { draftModelCard, extractFacts, paraphraseFacts } from "@/lib/nemotron/generate";
import { describeEvaluation } from "@/lib/nemotron/model-card";
import {
  EVAL_ANSWER_MAX_TOKENS,
  JUDGE_MAX_TOKENS,
  stepEvaluation,
  type EvalItemRow,
  type EvalRunRow,
  type FineTunedAnswer,
} from "@/lib/nemotron/run-evaluation";
import type { DatasetSummary } from "@/lib/models/dataset";
import { GatewayError, runChat, type ChatRequest } from "../../gateway/runtime";
import { organizationAuth } from "./access";
import { actorOf, loadOrgModel, message } from "./shared";
import type { ApiEnv } from "../types";

/*
 * Token Factory の Nemotron を使う機能: 学習データ作り・評価・モデルカードの下書き。
 * どれも組織のメンバーなら使える (公開は従来どおり管理者だけ)。トークン代は組織のクレジットから引く。
 */

const nemotron = new Hono<ApiEnv>();

nemotron.use("/:organizationId/models/:modelId/dataset-builder", organizationAuth());
nemotron.use("/:organizationId/models/:modelId/evaluations", organizationAuth());
nemotron.use("/:organizationId/models/:modelId/model-card/draft", organizationAuth());
nemotron.use("/:organizationId/evaluations/*", organizationAuth());

const yenOf = (micros: number) => Math.ceil(micros / 1_000_000);

function insufficient(c: Context<ApiEnv>, holdMicros: number) {
  return c.json(message(c, "server.nemotron.insufficientCredits", { amount: yenOf(holdMicros) }), 402);
}

/* ---------------------------------------------------------------- 学習データ作り */

/** 資料は毎回まるごと送られてくる (かたまりの番号で区切る)。上限は資料と役割の合計の目安 */
const BUILDER_MAX_BODY_BYTES = 512 * 1024;

const role = z.string().trim().min(1).max(BUILDER_ROLE_MAX_CHARS);
/** facts: 資料の chunk 番目から事実を取り出す / paraphrase: 事実を言い換える (画面が runBuild の順に送る) */
const builderSchema = z.discriminatedUnion("stage", [
  z.object({
    stage: z.literal("facts"),
    role,
    material: z.string().trim().min(1).max(BUILDER_MATERIAL_MAX_CHARS),
    chunk: z.number().int().min(0).max(1000),
  }),
  z.object({
    stage: z.literal("paraphrase"),
    role,
    facts: z
      .array(
        z.object({
          fact: z.string().max(GENERATED_ASSISTANT_MAX_CHARS),
          answer: z.string().min(1).max(GENERATED_ASSISTANT_MAX_CHARS),
          /** 既にある質問 (先頭が元の質問)。これと違う言い方を作らせる */
          questions: z.array(z.string().min(1).max(GENERATED_USER_MAX_CHARS)).min(1).max(50),
        }),
      )
      .min(1)
      .max(BUILDER_FACTS_PER_CALL),
  }),
]);

nemotron.post("/:organizationId/models/:modelId/dataset-builder", async (c) => {
  const organizationId = c.req.param("organizationId");
  if (Number(c.req.header("content-length") ?? 0) > BUILDER_MAX_BODY_BYTES) {
    return c.json(message(c, "server.nemotron.materialTooLarge"), 413);
  }
  const model = await loadOrgModel(c.env, organizationId, c.req.param("modelId"));
  if (!model) return c.json(message(c, "server.models.notFound"), 404);
  const input = builderSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json(message(c, "server.nemotron.invalidInput"), 400);

  const deps = nemotronDeps(c.env);
  const data = input.data;
  const referenceId = `dataset:${crypto.randomUUID()}`;
  try {
    const result =
      data.stage === "facts"
        ? await extractFacts(deps, { organizationId, referenceId, ...data })
        : await paraphraseFacts(deps, { organizationId, referenceId, ...data });
    if (!result) return c.json(message(c, "server.nemotron.invalidInput"), 400);
    await recordAuditLog(c.env, {
      organizationId,
      actor: actorOf(c),
      action: "dataset.generate",
      targetId: model.id,
      targetLabel: model.name,
      metadata: {
        stage: data.stage,
        ...(data.stage === "facts" ? { chunk: data.chunk } : {}),
        facts: "facts" in result ? result.facts.length : result.questions.length,
        dropped: result.dropped.length,
        costMicros: result.costMicros,
      },
    });
    return c.json(result);
  } catch (error) {
    if (error instanceof InsufficientCreditsError) return insufficient(c, error.holdMicros);
    console.error("学習データを作れませんでした:", model.id, error);
    return c.json(message(c, "server.nemotron.failed"), 502);
  }
});

/* ---------------------------------------------------------------- 評価 */

function toRunDto(row: EvalRunRow) {
  return {
    id: row.id,
    fineTuneId: row.fineTuneId,
    status: row.status,
    baselineModel: row.baselineModel,
    judgeModel: row.judgeModel,
    itemCount: row.itemCount,
    summary: readSummary(row.summary),
    costMicros: row.costMicros,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function readPrompt(text: string): ChatMessage[] {
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? (value as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function toItemDto(row: EvalItemRow) {
  return {
    id: row.id,
    position: row.position,
    prompt: readPrompt(row.prompt),
    reference: row.reference,
    status: row.status,
    fineTunedAnswer: row.fineTunedAnswer,
    baseAnswer: row.baseAnswer,
    fineTunedScore: row.fineTunedScore,
    baseScore: row.baseScore,
    fineTunedReason: row.fineTunedReason,
    baseReason: row.baseReason,
    error: row.error,
  };
}

/** 1問あたりの Token Factory 代の上限の見込み (ベースの答え + 採点)。実際はたいていこれより安い */
function perItemHoldMicros(prompt: { prompt: ChatMessage[]; reference: string }) {
  const promptChars = prompt.prompt.reduce((sum, message) => sum + message.content.length, 0);
  return (
    tokenFactoryHoldMicros({ inputChars: promptChars, maxTokens: EVAL_ANSWER_MAX_TOKENS }) +
    tokenFactoryHoldMicros({
      inputChars: promptChars + prompt.reference.length + 2 * EVAL_ANSWER_MAX_TOKENS * 4 + 2_000,
      maxTokens: JUDGE_MAX_TOKENS,
    })
  );
}

async function loadFineTuneRow(env: CloudflareEnv, organizationId: string, id: string | null) {
  if (!id) return null;
  const [row] = await getDb(env)
    .select()
    .from(fineTune)
    .where(and(eq(fineTune.organizationId, organizationId), eq(fineTune.id, id)))
    .limit(1);
  return row ?? null;
}

/** 評価できる状態か。できなければ理由 (画面で案内する) */
function evaluationBlocker(model: ModelRow, job: FineTuneRow | null) {
  if (!model.endpointId || !job) return "not_deployed" as const;
  if (!job.evalSet || job.evalExamples < 1) return "no_eval_set" as const;
  return null;
}

nemotron.get("/:organizationId/models/:modelId/evaluations", async (c) => {
  const organizationId = c.req.param("organizationId");
  const model = await loadOrgModel(c.env, organizationId, c.req.param("modelId"));
  if (!model) return c.json(message(c, "server.models.notFound"), 404);
  const job = await loadFineTuneRow(c.env, organizationId, model.fineTuneId);
  const rows = await getDb(c.env)
    .select()
    .from(evalRun)
    .where(and(eq(evalRun.organizationId, organizationId), eq(evalRun.modelId, model.id)))
    .orderBy(desc(evalRun.createdAt))
    .limit(10);
  const prompts = job?.evalSet ? evalPromptsFromJsonl(job.evalSet, EVAL_MAX_ITEMS) : [];
  return c.json({
    items: rows.map(toRunDto),
    fineTuneId: job?.id ?? null,
    blocker: evaluationBlocker(model, job),
    questions: prompts.length,
    estimateMicros: prompts.reduce((sum, prompt) => sum + perItemHoldMicros(prompt), 0),
    baselineModel: nemotronDeps(c.env).model,
  });
});

nemotron.post("/:organizationId/models/:modelId/evaluations", async (c) => {
  const organizationId = c.req.param("organizationId");
  const model = await loadOrgModel(c.env, organizationId, c.req.param("modelId"));
  if (!model) return c.json(message(c, "server.models.notFound"), 404);
  const job = await loadFineTuneRow(c.env, organizationId, model.fineTuneId);
  const blocker = evaluationBlocker(model, job);
  if (blocker || !job?.evalSet) {
    return c.json(message(c, `server.nemotron.evaluation.${blocker ?? "no_eval_set"}`), 400);
  }
  const prompts = evalPromptsFromJsonl(job.evalSet, EVAL_MAX_ITEMS);
  if (prompts.length === 0) return c.json(message(c, "server.nemotron.evaluation.no_eval_set"), 400);

  // 少なくとも1問分を払えなければ始めない (途中で止まっても、足してから続きを進められる)
  const deps = nemotronDeps(c.env);
  const firstHold = perItemHoldMicros(prompts[0]);
  if ((await computeDeps(c.env).credits.balance(organizationId)) < firstHold) {
    return insufficient(c, firstHold);
  }

  const db = getDb(c.env);
  const actor = actorOf(c);
  const now = new Date();
  // 同じモデルで途中の評価があれば打ち切る (新しい評価に置きかえる)
  await db
    .update(evalRun)
    .set({ status: "canceled", completedAt: now })
    .where(and(eq(evalRun.modelId, model.id), eq(evalRun.status, "running")));
  const run: EvalRunRow = {
    id: crypto.randomUUID(),
    organizationId,
    modelId: model.id,
    fineTuneId: job.id,
    createdBy: actor.id,
    status: "running",
    baselineModel: deps.model,
    judgeModel: deps.model,
    itemCount: prompts.length,
    summary: null,
    costMicros: 0,
    error: null,
    createdAt: now,
    completedAt: null,
    updatedAt: now,
  };
  await db.insert(evalRun).values(run);
  await db.insert(evalItem).values(
    prompts.map((prompt, position) => ({
      id: crypto.randomUUID(),
      runId: run.id,
      position,
      prompt: JSON.stringify(prompt.prompt),
      reference: prompt.reference,
      status: "pending",
      attempts: 0,
      claimedAt: null,
      fineTunedFirst: fineTunedFirstFor(position, run.id),
      updatedAt: now,
    })),
  );
  await recordAuditLog(c.env, {
    organizationId,
    actor,
    action: "evaluation.start",
    targetId: run.id,
    targetLabel: model.name,
    metadata: { modelId: model.id, fineTuneId: job.id, items: prompts.length, baselineModel: deps.model },
  });
  return c.json(toRunDto(run), 201);
});

async function loadRun(env: CloudflareEnv, organizationId: string, runId: string) {
  const [row] = await getDb(env)
    .select()
    .from(evalRun)
    .where(and(eq(evalRun.organizationId, organizationId), eq(evalRun.id, runId)))
    .limit(1);
  return row ?? null;
}

nemotron.get("/:organizationId/evaluations/:runId", async (c) => {
  const run = await loadRun(c.env, c.req.param("organizationId"), c.req.param("runId"));
  if (!run) return c.json(message(c, "server.nemotron.evaluation.notFound"), 404);
  const items = await getDb(c.env)
    .select()
    .from(evalItem)
    .where(eq(evalItem.runId, run.id))
    .orderBy(asc(evalItem.position));
  return c.json({ ...toRunDto(run), items: items.map(toItemDto) });
});

/** 微調整したモデルに、利用者と同じ経路 (gateway の runChat) で答えさせる。自組織のモデルなので呼び出しごとの料金は無い */
function fineTunedAnswerer(c: Context<ApiEnv>, model: ModelRow, organizationId: string) {
  const config = parseModelConfig(model.config);
  const userId = actorOf(c).id;
  return async (prompt: ChatMessage[]): Promise<FineTunedAnswer> => {
    if (!config) return { ok: false, reason: "error", message: "Model is not configured" };
    try {
      const request: ChatRequest = {
        model: model.slug,
        messages: prompt,
        max_tokens: EVAL_ANSWER_MAX_TOKENS,
        temperature: 0,
      };
      const response = await runChat(
        {
          env: c.env,
          waitUntil: (promise) => c.executionCtx.waitUntil(promise),
          model,
          config,
          consumerOrganizationId: organizationId,
          apiKeyId: null,
          userId,
          source: "eval",
        },
        request,
      );
      const payload = (await response.json().catch(() => null)) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      } | null;
      const content = payload?.choices?.[0]?.message?.content;
      return { ok: true, content: typeof content === "string" ? content : "" };
    } catch (error) {
      if (error instanceof GatewayError) {
        if (error.code === "model_warming_up") {
          return {
            ok: false,
            reason: "warming_up",
            retryAfter: Number(error.headers["Retry-After"]) || 30,
          };
        }
        if (error.code === "insufficient_credits") return { ok: false, reason: "insufficient_credits" };
        return { ok: false, reason: "error", message: error.message };
      }
      return { ok: false, reason: "error", message: errorText(error) };
    }
  };
}

nemotron.post("/:organizationId/evaluations/:runId/step", async (c) => {
  const organizationId = c.req.param("organizationId");
  const run = await loadRun(c.env, organizationId, c.req.param("runId"));
  if (!run) return c.json(message(c, "server.nemotron.evaluation.notFound"), 404);
  if (run.status !== "running") {
    return c.json({ state: "done", run: toRunDto(run) });
  }
  const model = await loadOrgModel(c.env, organizationId, run.modelId);
  const store = evalStore(c.env);
  // 評価の途中で別の LoRA に載せ替えたら、その評価は続けられない
  if (!model || model.fineTuneId !== run.fineTuneId || !model.endpointId) {
    await store.finishRun(run.id, {
      status: "failed",
      error: "The deployed adapter changed during the evaluation",
      completedAt: new Date(),
    });
    const failed = await loadRun(c.env, organizationId, run.id);
    return c.json({ state: "done", run: failed ? toRunDto(failed) : null });
  }
  const result = await stepEvaluation(
    {
      nemotron: nemotronDeps(c.env),
      store,
      answerFineTuned: fineTunedAnswerer(c, model, organizationId),
      now: () => new Date(),
    },
    run,
  );
  const latest = await loadRun(c.env, organizationId, run.id);
  const dto = latest ? toRunDto(latest) : toRunDto(run);
  if (result.state === "insufficient_credits") {
    return c.json(
      { ...message(c, "server.nemotron.evaluation.paused"), state: result.state, run: dto },
      402,
    );
  }
  return c.json({ ...result, run: dto });
});

/* ---------------------------------------------------------------- モデルカード */

const cardSchema = z.object({ locale: z.enum(["ja", "en"]).optional() });

function describeDataset(job: FineTuneRow) {
  const summary = ((): DatasetSummary | null => {
    try {
      return job.datasetSummary ? (JSON.parse(job.datasetSummary) as DatasetSummary) : null;
    } catch {
      return null;
    }
  })();
  const lines = [`Training examples: ${job.datasetExamples}`, `Base model: ${job.baseModelId}`];
  if (summary?.role) lines.push(`Assistant role written by the creator: ${summary.role}`);
  if (summary?.systemPrompt) lines.push(`System prompt used in training: ${summary.systemPrompt}`);
  if (summary?.sampleQuestions.length) {
    lines.push("Sample user questions from the training data:");
    for (const question of summary.sampleQuestions) lines.push(`- ${question}`);
  }
  return lines.join("\n");
}

nemotron.post("/:organizationId/models/:modelId/model-card/draft", async (c) => {
  const organizationId = c.req.param("organizationId");
  const model = await loadOrgModel(c.env, organizationId, c.req.param("modelId"));
  if (!model) return c.json(message(c, "server.models.notFound"), 404);
  const input = cardSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!input.success) return c.json(message(c, "server.nemotron.invalidInput"), 400);

  // 載せている LoRA の学習、無ければ最後に成功した学習
  let job = await loadFineTuneRow(c.env, organizationId, model.fineTuneId);
  if (!job) {
    const [latest] = await getDb(c.env)
      .select()
      .from(fineTune)
      .where(
        and(
          eq(fineTune.organizationId, organizationId),
          eq(fineTune.modelId, model.id),
          inArray(fineTune.status, ["succeeded"]),
        ),
      )
      .orderBy(desc(fineTune.createdAt))
      .limit(1);
    job = latest ?? null;
  }
  if (!job) return c.json(message(c, "server.nemotron.card.needsTraining"), 400);
  const evaluation = await latestEvaluationFor(c.env, model.id, job.id);
  const deps = nemotronDeps(c.env);
  try {
    const result = await draftModelCard(deps, {
      organizationId,
      referenceId: `card:${crypto.randomUUID()}`,
      locale: input.data.locale ?? "en",
      modelName: model.name,
      datasetSummary: describeDataset(job),
      evaluation: evaluation
        ? describeEvaluation(evaluation.summary, {
            baseline: evaluation.baselineModel,
            judge: evaluation.judgeModel,
          })
        : null,
    });
    await recordAuditLog(c.env, {
      organizationId,
      actor: actorOf(c),
      action: "model_card.draft",
      targetId: model.id,
      targetLabel: model.name,
      metadata: { fineTuneId: job.id, ok: result.ok, costMicros: result.costMicros },
    });
    if (!result.ok) return c.json(message(c, "server.nemotron.card.invalidOutput"), 502);
    return c.json({ ...result.draft, costMicros: result.costMicros });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) return insufficient(c, error.holdMicros);
    console.error("モデルカードの下書きを作れませんでした:", model.id, error);
    return c.json(message(c, "server.nemotron.failed"), 502);
  }
});

export default nemotron;
