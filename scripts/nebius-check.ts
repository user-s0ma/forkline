// Nebius の認証と権限を確かめる (読み取りだけ)。`npx tsx scripts/nebius-check.ts`
import { readFileSync } from "node:fs";
import { nebiusApi } from "../src/lib/nebius/api";

const env: Record<string, string> = {};
for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const project = env.NEBIUS_PROJECT_ID;
for (const path of (process.argv[2] ? [process.argv[2].replace("{project}", project)] : [`/ai/v1/endpoints?parentId=${project}`, `/ai/v1/jobs?parentId=${project}`])) {
  try {
    const r = await nebiusApi<Record<string, unknown>>(env as never, "GET", path);
    console.log("OK", path.split("?")[0], JSON.stringify(r).slice(0, Number(process.argv[3] ?? 300)));
  } catch (e) {
    console.log("NG", path.split("?")[0], (e as Error).message.slice(0, 400));
  }
}
