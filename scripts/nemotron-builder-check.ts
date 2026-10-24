// Token Factory の Nemotron に学習データ作りを頼み (事実の取り出し → 言い換え)、生の返事と読み取りの結果を見る (料金は数円)。
//   npx tsx scripts/nemotron-builder-check.ts
import { readFileSync } from "node:fs";
import { tokenFactoryChat, DEFAULT_TOKEN_FACTORY_MODEL } from "../src/lib/nebius";
import { factsMessages, paraphraseMessages } from "../src/lib/nemotron/prompts";
import {
  BUILDER_FACTS_MAX_TOKENS,
  BUILDER_FACTS_PER_CALL,
  BUILDER_PARAPHRASE_MAX_TOKENS,
  BUILDER_PARAPHRASES, BUILDER_SHORT_PARAPHRASES,
  FACTS_JSON_SCHEMA,
  factExamples,
  paraphraseJsonSchema,
  parseFacts,
  parseParaphrases,
} from "../src/lib/nemotron/dataset-builder";

const env: Record<string, string> = {};
for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const role = "パン屋「みどり堂」の問い合わせ係。丁寧に、短く答える。";
const material = [
  "営業時間：朝7時から夕方6時まで。定休日は毎週水曜日（祝日の水曜日も休み）。",
  "焼き上がり時刻：食パンは朝7時と午後2時。クロワッサンは朝8時ごろ。メロンパンは朝9時ごろ。",
  "支払い：現金、クレジットカード、交通系ICカード、QRコード決済が使える。",
  "配達：していない。取り置きを利用してください。",
].join("\n");

const extracted = await tokenFactoryChat(env as never, {
  model: DEFAULT_TOKEN_FACTORY_MODEL,
  messages: factsMessages({ role, material }),
  maxTokens: BUILDER_FACTS_MAX_TOKENS,
  jsonSchema: FACTS_JSON_SCHEMA,
});
console.log("facts usage", JSON.stringify(extracted.usage));
console.log("--- facts raw (first 3000 chars)\n" + extracted.content.slice(0, 3000));
const { facts, unanswerable, dropped } = parseFacts(extracted.content);
console.log(`--- parsed: ${facts.length} facts, ${unanswerable.length} unanswerable, dropped ${JSON.stringify(dropped)}`);

// 言い換えは最初の1回分だけ
const batch = facts.slice(0, BUILDER_FACTS_PER_CALL);
if (batch.length) {
  const paraphrased = await tokenFactoryChat(env as never, {
    model: DEFAULT_TOKEN_FACTORY_MODEL,
    messages: paraphraseMessages({ role, facts: batch, count: BUILDER_PARAPHRASES, short: BUILDER_SHORT_PARAPHRASES }),
    maxTokens: BUILDER_PARAPHRASE_MAX_TOKENS,
    jsonSchema: paraphraseJsonSchema(batch.length),
  });
  console.log("paraphrase usage", JSON.stringify(paraphrased.usage));
  const parsed = parseParaphrases(paraphrased.content, batch.length);
  console.log(`--- paraphrases (dropped ${JSON.stringify(parsed.dropped)})`);
  batch.forEach((fact, index) => {
    const examples = factExamples({ ...fact, questions: [...fact.questions, ...parsed.questions[index]] });
    console.log(`\n# ${fact.fact}\n  A: ${fact.answer}`);
    for (const example of examples) console.log(`  ${example.heldOut ? "[eval]" : "      "} ${example.user}`);
  });
}
