import { chargedNemotronChat, type NemotronDeps } from "./charge";
import {
  BUILDER_FACTS_MAX_TOKENS,
  BUILDER_PARAPHRASE_MAX_TOKENS,
  BUILDER_PARAPHRASES,
  BUILDER_SHORT_PARAPHRASES,
  chunkMaterial,
  FACTS_JSON_SCHEMA,
  paraphraseJsonSchema,
  parseFacts,
  parseParaphrases,
  type Fact,
} from "./dataset-builder";
import { CARD_JSON_SCHEMA, CARD_MAX_TOKENS, parseModelCardDraft, type ModelCardDraft } from "./model-card";
import { factsMessages, modelCardMessages, paraphraseMessages } from "./prompts";

/*
 * 学習データ作りとモデルカードの下書きで、Nemotron を1回ずつ呼ぶ (サーバーだけで使う)。
 * 学習データ作りの順番 (取り出し → 言い換え) は画面が決める (runBuild)。1回の HTTP の依頼を短く保つため。
 */

type Billed = { costMicros: number; inputTokens: number; outputTokens: number };

/** 資料の chunk 番目のかたまりから事実を取り出す (Token Factory を1回呼ぶ)。chunk が範囲外なら null */
export async function extractFacts(
  deps: NemotronDeps,
  input: { organizationId: string; referenceId: string; role: string; material: string; chunk: number },
): Promise<(ReturnType<typeof parseFacts> & Billed & { chunkCount: number }) | null> {
  const chunks = chunkMaterial(input.material);
  const material = chunks[input.chunk];
  if (material === undefined) return null;
  const response = await chargedNemotronChat(deps, {
    organizationId: input.organizationId,
    kind: "dataset_build",
    referenceId: input.referenceId,
    description: `Dataset builder: facts (${input.chunk + 1}/${chunks.length})`,
    messages: factsMessages({ role: input.role, material }),
    maxTokens: BUILDER_FACTS_MAX_TOKENS,
    jsonSchema: FACTS_JSON_SCHEMA,
  });
  return {
    chunkCount: chunks.length,
    ...parseFacts(response.content),
    costMicros: response.costMicros,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
  };
}

/** 事実ごとに、違う言い方の質問を BUILDER_PARAPHRASES 個作る (Token Factory を1回呼ぶ) */
export async function paraphraseFacts(
  deps: NemotronDeps,
  input: { organizationId: string; referenceId: string; role: string; facts: Fact[] },
): Promise<ReturnType<typeof parseParaphrases> & Billed> {
  const response = await chargedNemotronChat(deps, {
    organizationId: input.organizationId,
    kind: "dataset_build",
    referenceId: input.referenceId,
    description: `Dataset builder: paraphrases (${input.facts.length} facts)`,
    messages: paraphraseMessages({ role: input.role, facts: input.facts, count: BUILDER_PARAPHRASES, short: BUILDER_SHORT_PARAPHRASES }),
    maxTokens: BUILDER_PARAPHRASE_MAX_TOKENS,
    jsonSchema: paraphraseJsonSchema(input.facts.length),
  });
  return {
    ...parseParaphrases(response.content, input.facts.length),
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
    jsonSchema: CARD_JSON_SCHEMA,
  });
  const draft = parseModelCardDraft(response.content);
  return draft
    ? { ok: true, draft, costMicros: response.costMicros }
    : { ok: false, costMicros: response.costMicros };
}
