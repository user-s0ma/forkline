// いちばん新しい学習の記録 (損失) と学習データを見る。`npx tsx scripts/finetune-inspect.ts`
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { s3Request } from "../src/lib/nebius/s3";

const env: Record<string, string> = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const url = new URL(env.DATABASE_URL);
url.searchParams.delete("sslaccept");
const db = await mysql.createConnection({ uri: url.toString(), ssl: { rejectUnauthorized: true } });
const [rows] = await db.query("SELECT id, status, datasetUri, adapterUri, evalSet FROM FineTune ORDER BY createdAt DESC LIMIT 1");
await db.end();
const ft = (rows as { id: string; status: string; datasetUri: string; adapterUri: string | null; evalSet: string | null }[])[0];
console.log(ft.id, ft.status);
const key = (uri: string) => uri.replace(/^s3:\/\/[^/]+\//, "");
const get = async (k: string) => (await s3Request(env as never, { method: "GET", key: k })).text();
if (ft.adapterUri) console.log("result", await get(`${key(ft.adapterUri)}/forkline-result.json`));
console.log("--- dataset");
for (const line of (await get(key(ft.datasetUri))).split("\n").filter(Boolean)) {
  const { messages } = JSON.parse(line) as { messages: { role: string; content: string }[] };
  console.log(messages.map((m) => `${m.role}: ${m.content}`).join(" | "));
}
console.log("--- held out\n" + (ft.evalSet ?? "").slice(0, 500));
