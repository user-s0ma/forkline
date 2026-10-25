// Forkline のサーバー。本番は Nebius の VM の上で、前段の Caddy から受ける。
//   本番: npm run build && npm start   (NODE_ENV=production)
//   開発: npm run dev                   (Vite を中に入れて、変更をその場で反映する)
// 設定は環境変数から読む (deploy/forkline.env.example)。
// 1分ごとの見回り (学習の状態、エンドポイントの GPU 代の請求、使われていないものの停止) もこのプロセスで回す。
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

for (const key of ["PORT", "HOST"]) {
  if (!process.env[key]) throw new Error(`${key} を設定してください`);
}
const PORT = Number(process.env.PORT);
const HOST = process.env.HOST;
const DEV = process.env.NODE_ENV !== "production";
const CLIENT_DIR = "./build/client";

let vite;
let app;
if (DEV) {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({ server: { middlewareMode: true }, appType: "custom" });
  // 呼ばれるたびに読み直す (Vite が変更を反映する)
  const load = () => vite.ssrLoadModule("./src/server/app.ts");
  app = {
    handle: async (...args) => (await load()).handle(...args),
    runScheduled: async (...args) => (await load()).runScheduled(...args),
  };
} else {
  app = await import("./build/server/index.js");
}

const env = process.env;

/** waitUntil に渡された処理は、応答を返したあともそのまま走らせる */
const ctx = {
  waitUntil(promise) {
    Promise.resolve(promise).catch((error) => console.error("後処理に失敗しました:", error));
  },
  passThroughOnException() {},
  props: {},
};

/**
 * 前段の Caddy が付けた X-Forwarded-Proto / X-Forwarded-For から、元の URL と接続元の IP を戻す。
 * 接続元の IP は better-auth が x-real-ip から読むので、利用者が送ってきた値は捨てて付け直す
 */
function toAppRequest(raw, incoming) {
  const url = new URL(raw.url);
  const proto = raw.headers.get("x-forwarded-proto");
  if (proto === "https" || proto === "http") url.protocol = `${proto}:`;
  const headers = new Headers(raw.headers);
  const forwarded = raw.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || incoming?.socket?.remoteAddress;
  headers.delete("x-real-ip");
  if (ip) headers.set("x-real-ip", ip);
  const hasBody = raw.method !== "GET" && raw.method !== "HEAD";
  return new Request(url, {
    method: raw.method,
    headers,
    body: hasBody ? raw.body : undefined,
    duplex: hasBody ? "half" : undefined,
    signal: raw.signal,
  });
}

const server = new Hono();

if (!DEV) {
  // ビルドした静的ファイル。名前に版が入っているので長く覚えさせる
  // (serveStatic の onFound は応答を作ったあとに呼ばれ、ヘッダーが付かないので、後から付ける)
  server.use("/assets/*", async (c, next) => {
    await next();
    if (c.res.status === 200) c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  });
  server.use("*", serveStatic({ root: CLIENT_DIR }));
}

server.all("*", (c) => app.handle(toAppRequest(c.req.raw, c.env?.incoming), env, ctx));

// 全体の Response を差し替えない (差し替えると fetch の応答が instanceof Response にならず、OG 画像の作成が失敗する)
const listener = getRequestListener(server.fetch, { overrideGlobalObjects: false });
const http = createServer((req, res) => {
  if (vite) vite.middlewares(req, res, () => listener(req, res));
  else listener(req, res);
});
http.listen(PORT, HOST, () => console.log(`forkline: http://${HOST}:${PORT}${DEV ? " (dev)" : ""}`));

// 1分ごとの見回り。前の回が終わっていなければ飛ばす
let sweeping = false;
async function sweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    await app.runScheduled(env);
  } catch (error) {
    console.error("見回りに失敗しました:", error);
  } finally {
    sweeping = false;
  }
}
// 手元の開発は本番と同じ DB を使うので、見回りは本番だけで回す (開発で回すときは RUN_CRON=1)
if (!DEV || process.env.RUN_CRON === "1") {
  setTimeout(() => {
    sweep();
    setInterval(sweep, 60_000);
  }, 60_000 - (Date.now() % 60_000));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    http.close(() => process.exit(0));
    vite?.close();
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
