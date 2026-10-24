// Object Storage に書けるかを確かめる。小さなファイルを1つ置き、あるかを確かめる。`npx tsx scripts/nebius-s3-check.ts`
import { readFileSync } from "node:fs";
import { s3Exists, s3Put } from "../src/lib/nebius/s3";

const env: Record<string, string> = {};
for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const key = "healthcheck/forkline.txt";
try {
  await s3Put(env as never, key, `ok ${new Date().toISOString()}\n`, "text/plain");
  console.log("PUT ok", key);
  console.log("exists", await s3Exists(env as never, key));
} catch (e) {
  console.log("NG", (e as Error).message.slice(0, 400));
}
