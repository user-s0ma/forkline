// デプロイ済みのエンドポイントに /v1/models を直接聞く。`npx tsx scripts/endpoint-probe.ts`
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { decryptSecretValue } from "../src/lib/organization/secret-box";
const env: Record<string, string> = {};
for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const url = new URL(env.DATABASE_URL); url.searchParams.delete("sslaccept");
const db = await mysql.createConnection({ uri: url.toString(), ssl: { rejectUnauthorized: true } });
const [rows] = await db.query("SELECT endpointUrl, endpointToken FROM AiModel WHERE slug='faq'");
await db.end();
const r = (rows as any[])[0];
console.log("url", r.endpointUrl);
const token = await decryptSecretValue(r.endpointToken, env.SECRET_ENCRYPTION_KEY);
const base = process.argv[2] ?? r.endpointUrl;
const res = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
console.log(res.status, (await res.text()).slice(0, 400));
