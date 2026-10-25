/**
 * サーバーの入口 (vite.config.ts が build/server/index.js に組み立てる)。
 * HTTP の受け口と1分ごとの見回りは server.mjs が回す
 */
import { createAppHandler } from "@/server/handler";
import { runScheduled } from "@/server/scheduled";

export const handle = createAppHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export { runScheduled };
