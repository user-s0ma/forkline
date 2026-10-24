import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext } from "@/lib/util/cloudflare-context";
import api from "./api";
import gateway from "./gateway";
import { runScheduled } from "./scheduled";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(
    request: Request,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // OpenAI 互換の公開 API
    if (url.pathname.startsWith("/v1/") || url.pathname === "/v1") {
      return gateway.fetch(request, env, ctx);
    }

    if (url.pathname.startsWith("/api/")) {
      return api.fetch(request, env, ctx);
    }

    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });

    const response = await requestHandler(request, context);
    try {
      if ((response.headers.get("content-type") || "").includes("text/html")) {
        response.headers.set(
          "Content-Security-Policy",
          "frame-ancestors 'none'",
        );
      }
    } catch {
      /*noop*/
    }
    return response;
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
