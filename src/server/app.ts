/**
 * Node で動かすときの入口 (vite.node.config.ts が build-node/server/index.js に組み立てる)。
 * Nebius の管理用 API は Cloudflare の網から届かないため、本番は Nebius の VM の上で Node として動かす。
 * 起動とバインディングの代わりは server.mjs が用意する
 */
import { createAppHandler } from "@/workers/handler";
import { runScheduled } from "@/workers/scheduled";

export const handle = createAppHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export { runScheduled };
