import { createAppHandler } from "./handler";
import { runScheduled } from "./scheduled";

const handle = createAppHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(
    request: Request,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return handle(request, env, ctx);
  },

  // 学習の状態の確認と、エンドポイントの課金・停止 (wrangler.jsonc の triggers.crons)
  async scheduled(
    _controller: ScheduledController,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(runScheduled(env));
  },
} satisfies ExportedHandler<CloudflareEnv>;
