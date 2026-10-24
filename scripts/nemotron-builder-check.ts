// Token Factory の Nemotron に学習データ作りを1回頼み、生の返事と読み取りの結果を見る (料金は数円)。
//   npx tsx scripts/nemotron-builder-check.ts
import { readFileSync } from "node:fs";
import { tokenFactoryChat, DEFAULT_TOKEN_FACTORY_MODEL } from "../src/lib/nebius";
import { datasetBuilderMessages } from "../src/lib/nemotron/prompts";
import { BUILDER_MAX_TOKENS, EXAMPLES_JSON_SCHEMA, parseGeneratedExamples } from "../src/lib/nemotron/dataset-builder";

const env: Record<string, string> = {};
for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const material = [
  "営業時間：朝7時から夕方6時まで。定休日は毎週水曜日（祝日の水曜日も休み）。",
  "焼き上がり時刻：食パンは朝7時と午後2時。クロワッサンは朝8時ごろ。メロンパンは朝9時ごろ。",
  "支払い：現金、クレジットカード、交通系ICカード、QRコード決済が使える。",
  "配達：していない。取り置きを利用してください。",
].join("\n");

const messages = datasetBuilderMessages({
  role: "パン屋「みどり堂」の問い合わせ係。丁寧に、短く答える。",
  material,
  count: 8,
});
const { content, usage } = await tokenFactoryChat(env as never, {
  model: DEFAULT_TOKEN_FACTORY_MODEL,
  messages,
  maxTokens: BUILDER_MAX_TOKENS,
  jsonSchema: EXAMPLES_JSON_SCHEMA,
});
console.log("usage", JSON.stringify(usage));
console.log("--- raw (first 3000 chars)\n" + content.slice(0, 3000));
console.log("--- parsed\n" + JSON.stringify(parseGeneratedExamples(content, { max: 8 }), null, 1).slice(0, 2000));
