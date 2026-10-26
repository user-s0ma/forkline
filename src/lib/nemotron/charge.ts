import type { ChatMessage, ChatUsage, NebiusEnv } from "../nebius";
import type * as Nebius from "../nebius";
import { tokenFactoryCostMicros, tokenFactoryHoldMicros } from "../billing/compute";
import type { CreditPort } from "../compute/types";

/*
 * Token Factory の Nemotron を呼び、使ったトークン代を利用者のクレジットから引く。
 *   呼ぶ前: 入力の文字数と max_tokens から見込み額を仮押さえ (足りなければ呼ばない)
 *   呼んだ後: 実際のトークン数で精算する (台帳に1行、referenceId で一度だけ)
 *   失敗したら: 仮押さえを戻す
 * 単価は src/lib/billing/compute.ts の TOKEN_FACTORY_USD_PER_M_*。
 */

export type NemotronKind = "dataset_build" | "evaluation" | "model_card";

export type NemotronDeps = {
  env: NebiusEnv;
  /** src/lib/nebius の tokenFactoryChat (テストでは偽物) */
  chat: typeof Nebius.tokenFactoryChat;
  /** Token Factory のモデル ID */
  model: string;
  credits: Pick<CreditPort, "reserve" | "release" | "settle">;
};

export class InsufficientCreditsError extends Error {
  constructor(readonly holdMicros: number) {
    super("Insufficient credits");
  }
}

export type ChargedChat = { content: string; usage: ChatUsage; costMicros: number };

/** usage が返らなかったときは、文字数からトークン数を多めに見積もって請求する */
function billableUsage(usage: ChatUsage, inputChars: number, outputChars: number): ChatUsage {
  if (usage.inputTokens > 0 || usage.outputTokens > 0) return usage;
  return { inputTokens: Math.ceil(inputChars / 2), outputTokens: Math.ceil(outputChars / 2) };
}

export async function chargedNemotronChat(
  deps: NemotronDeps,
  input: {
    userId: string;
    kind: NemotronKind;
    /** 精算を一度だけにするための ID (呼び出しごとに変える) */
    referenceId: string;
    description: string;
    messages: ChatMessage[];
    maxTokens: number;
    /** 返す JSON の形 (tokenFactoryChat の jsonSchema) */
    jsonSchema?: { name: string; schema: Record<string, unknown> };
  },
): Promise<ChargedChat> {
  const inputChars = input.messages.reduce((sum, message) => sum + message.content.length, 0);
  const hold = tokenFactoryHoldMicros({ inputChars, maxTokens: input.maxTokens });
  if (!(await deps.credits.reserve(input.userId, hold))) {
    throw new InsufficientCreditsError(hold);
  }
  let result: { content: string; usage: ChatUsage };
  try {
    result = await deps.chat(deps.env, {
      model: deps.model,
      messages: input.messages,
      maxTokens: input.maxTokens,
      ...(input.jsonSchema ? { jsonSchema: input.jsonSchema } : {}),
    });
  } catch (error) {
    await deps.credits.release(input.userId, hold);
    throw error;
  }
  const usage = billableUsage(result.usage, inputChars, result.content.length);
  const costMicros = tokenFactoryCostMicros(usage);
  try {
    const settled = await deps.credits.settle({
      userId: input.userId,
      kind: input.kind,
      referenceId: input.referenceId,
      heldMicros: hold,
      actualMicros: costMicros,
      description: input.description,
    });
    // 同じ referenceId で精算済みなら残高は動いていないので、仮押さえだけ戻す
    if (settled === "duplicate") await deps.credits.release(input.userId, hold);
  } catch (error) {
    console.error("Token Factory の料金を精算できませんでした:", input.referenceId, error);
    await deps.credits.release(input.userId, hold);
  }
  return { content: result.content, usage, costMicros };
}
