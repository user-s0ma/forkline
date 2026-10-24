// Nebius Container Registry を用意して、イメージを置く先 (cr.<region>.nebius.cloud/<path>) を表示する。
//   npx tsx scripts/nebius-registry.ts            既にあればそれを、無ければ forkline を作る
//   npx tsx scripts/nebius-registry.ts token      docker login に渡す IAM トークンを出す (標準出力だけ)
import { readFileSync } from "node:fs";
import { nebiusApi } from "../src/lib/nebius/api";
import { getAccessToken } from "../src/lib/nebius/auth";

const env: Record<string, string> = {};
for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const project = env.NEBIUS_PROJECT_ID;

if (process.argv[2] === "token") {
  process.stdout.write(await getAccessToken(env as never));
} else {
  type Registry = { metadata: { id: string; name: string } };
  const list = await nebiusApi<{ items?: Registry[] }>(env as never, "GET", `/registry/v1/registries?parentId=${project}`);
  let registry = list.items?.find((r) => r.metadata.name === "forkline");
  if (!registry) {
    await nebiusApi(env as never, "POST", "/registry/v1/registries", {
      metadata: { parentId: project, name: "forkline" },
      spec: {},
    });
    for (let i = 0; i < 30 && !registry; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const again = await nebiusApi<{ items?: Registry[] }>(env as never, "GET", `/registry/v1/registries?parentId=${project}`);
      registry = again.items?.find((r) => r.metadata.name === "forkline");
    }
  }
  if (!registry) throw new Error("Registry を作れませんでした");
  const path = registry.metadata.id.replace(/^registry-/, "");
  console.log(`cr.${env.NEBIUS_REGION}.nebius.cloud/${path}`);
}
