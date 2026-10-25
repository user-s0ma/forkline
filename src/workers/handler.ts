import { createRequestHandler, RouterContextProvider, type ServerBuild } from "react-router";
import { cloudflareContext } from "@/lib/util/cloudflare-context";
import api from "./api";
import gateway from "./gateway";

/**
 * 1つのリクエストを公開 API (/v1)、画面の API (/api)、画面 (React Router) に振り分ける。
 * Cloudflare Workers (app.ts) と Node のサーバー (src/server/app.ts) で共通に使う
 */
export function createAppHandler(build: () => Promise<ServerBuild>, mode: string) {
  const requestHandler = createRequestHandler(build, mode);

  return async function handle(
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
  };
}
