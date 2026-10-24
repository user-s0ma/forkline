import { chargedNemotronChat, type NemotronDeps } from "./charge";
import {
  BUILDER_MAX_TOKENS,
  chunkMaterial,
  parseGeneratedExamples,
  type DroppedItem,
  type GeneratedExample,
} from "./dataset-builder";
import { CARD_MAX_TOKENS, parseModelCardDraft, type ModelCardDraft } from "./model-card";
import { datasetBuilderMessages, modelCardMessages } from "./prompts";

/*
 * 学習データ作りとモデルカードの下書きで、Nemotron を1回ずつ呼ぶ (サーバーだけで使う)。
 */

export type GenerateChunkResult = {
  chunkCount: number;
  examples: GeneratedExample[];
  dropped: DroppedItem[];
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
};

/** 資料の chunk 番目のかたまりから例を作る。chunk が範囲外なら null */
export async function generateChunk(
  deps: NemotronDeps,
  input: {
    organizationId: string;
    referenceId: string;
    role: string;
    material: string;
    chunk: number;
    perChunk: number;
    /** 前のかたまりで作った質問 (重複を捨てるため) */
    seenQuestions?: string[];
  },
): Promise<GenerateChunkResult | null> {
  const chunks = chunkMaterial(input.material);
  const material = chunks[input.chunk];
  if (material === undefined) return null;
  const response = await chargedNemotronChat(deps, {
    organizationId: input.organizationId,
    kind: "dataset_build",
    referenceId: input.referenceId,
    description: `Dataset builder (${input.chunk + 1}/${chunks.length})`,
    messages: datasetBuilderMessages({ role: input.role, material, count: input.perChunk }),
    maxTokens: BUILDER_MAX_TOKENS,
  });
  const seen = new Set(
    (input.seenQuestions ?? []).map((question) => question.trim().toLowerCase().replace(/\s+/g, " ")),
  );
  const parsed = parseGeneratedExamples(response.content, { max: input.perChunk, seen });
  return {
    chunkCount: chunks.length,
    ...parsed,
    costMicros: response.costMicros,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
  };
}

export type DraftCardResult =
  | { ok: true; draft: ModelCardDraft; costMicros: number }
  | { ok: false; costMicros: number };

export async function draftModelCard(
  deps: NemotronDeps,
  input: {
    organizationId: string;
    referenceId: string;
    locale: "ja" | "en";
    modelName: string;
    datasetSummary: string;
    evaluation: string | null;
  },
): Promise<DraftCardResult> {
  const response = await chargedNemotronChat(deps, {
    organizationId: input.organizationId,
    kind: "model_card",
    referenceId: input.referenceId,
    description: `Model card draft (${input.modelName})`.slice(0, 255),
    messages: modelCardMessages(input),
    maxTokens: CARD_MAX_TOKENS,
  });
  const draft = parseModelCardDraft(response.content);
  return draft
    ? { ok: true, draft, costMicros: response.costMicros }
    : { ok: false, costMicros: response.costMicros };
}
