// Forkline を Node のサーバーとして動かす (本番は Nebius の VM の上)。
//   npm run build:node && node server.mjs
// Cloudflare Workers のバインディングの代わりをここで用意する:
//   EMAIL                 メール送信の中継 Worker (deploy/mail-relay) に送る
//   GATEWAY_RATE_LIMITER  API キーごとの回数制限をこのプロセスの中で数える
//   triggers.crons        1分ごとの見回りをこのプロセスの中で回す
// 設定は環境変数から読む (deploy/forkline.env.example)。
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { handle, runScheduled } from "./build-node/server/index.js";

const PORT = Number(process.env.PORT ?? 3000);
const CLIENT_DIR = "./build-node/client";

/** env.EMAIL.send と同じ形で受け取り、中継の Worker に渡す */
function mailRelay() {
  return {
    async send(message) {
      const url = process.env.MAIL_RELAY_URL;
      const secret = process.env.MAIL_RELAY_SECRET;
      if (!url || !secret) throw new Error("MAIL_RELAY_URL と MAIL_RELAY_SECRET を設定してください");
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`メールを送れませんでした (${res.status} ${(await res.text()).slice(0, 200)})`);
    },
  };
}

/** wrangler.jsonc の ratelimits と同じ (60秒に600回)。プロセスが1つなので、メモリーで数える */
function rateLimiter(limit, periodSeconds) {
  const windows = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, w] of windows) if (now - w.start >= periodSeconds * 1000) windows.delete(key);
  }, periodSeconds * 1000).unref();
  return {
    async limit({ key }) {
      const now = Date.now();
      let w = windows.get(key);
      if (!w || now - w.start >= periodSeconds * 1000) {
        w = { start: now, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      return { success: w.count <= limit };
    },
  };
}

const env = {
  ...process.env,
  EMAIL: mailRelay(),
  GATEWAY_RATE_LIMITER: rateLimiter(600, 60),
};

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
 * 接続元の IP は better-auth が cf-connecting-ip から読むので、利用者が送ってきた値は捨てて付け直す
 */
function toAppRequest(raw, incoming) {
  const url = new URL(raw.url);
  const proto = raw.headers.get("x-forwarded-proto");
  if (proto === "https" || proto === "http") url.protocol = `${proto}:`;
  const headers = new Headers(raw.headers);
  const forwarded = raw.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || incoming?.socket?.remoteAddress;
  headers.delete("cf-connecting-ip");
  if (ip) headers.set("cf-connecting-ip", ip);
  const hasBody = raw.method !== "GET" && raw.method !== "HEAD";
  return new Request(url, {
    method: raw.method,
    headers,
    body: hasBody ? raw.body : undefined,
    duplex: hasBody ? "half" : undefined,
    signal: raw.signal,
  });
}

const app = new Hono();

// ビルドした静的ファイル。名前に版が入っているので長く覚えさせる
// (serveStatic の onFound は応答を作ったあとに呼ばれ、ヘッダーが付かないので、後から付ける)
app.use("/assets/*", async (c, next) => {
  await next();
  if (c.res.status === 200) c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
});
app.use("*", serveStatic({ root: CLIENT_DIR }));

app.all("*", (c) => handle(toAppRequest(c.req.raw, c.env?.incoming), env, ctx));

// 全体の Response を差し替えない (差し替えると fetch の応答が instanceof Response にならず、OG 画像の作成が失敗する)
const server = serve({ fetch: app.fetch, port: PORT, hostname: process.env.HOST ?? "127.0.0.1", overrideGlobalObjects: false }, (info) => {
  console.log(`forkline: http://${info.address}:${info.port}`);
});

// 1分ごとの見回り。前の回が終わっていなければ飛ばす
let sweeping = false;
async function sweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    await runScheduled(env);
  } catch (error) {
    console.error("見回りに失敗しました:", error);
  } finally {
    sweeping = false;
  }
}
if (process.env.DISABLE_CRON !== "1") {
  setTimeout(() => {
    sweep();
    setInterval(sweep, 60_000);
  }, 60_000 - (Date.now() % 60_000));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
