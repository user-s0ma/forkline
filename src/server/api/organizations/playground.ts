import { Hono } from "hono";
import {
  errorResponse,
  GatewayError,
  readChatRequest,
  resolveModel,
  runChat,
} from "../../gateway/runtime";
import { organizationAuth } from "./access";
import type { ApiEnv } from "../types";

/**
 * 画面からモデルを試す。ログイン中の人が選んだ組織のクレジットで払う (メンバーなら誰でも)。
 * 返し方は /v1/chat/completions と同じ。
 */
const playground = new Hono<ApiEnv>();

playground.use("/:organizationId/playground/*", organizationAuth());

playground.post("/:organizationId/playground/chat", async (c) => {
  const organizationId = c.req.param("organizationId");
  try {
    const request = await readChatRequest(c.req.raw);
    const { model, config } = await resolveModel(c.env, request.model, organizationId);
    return await runChat(
      {
        env: c.env,
        waitUntil: (promise) => c.executionCtx.waitUntil(promise),
        model,
        config,
        consumerOrganizationId: organizationId,
        apiKeyId: null,
        userId: c.get("authorization").actor.id,
        source: "playground",
      },
      request,
    );
  } catch (error) {
    if (error instanceof GatewayError) return errorResponse(error);
    throw error;
  }
});

export default playground;
