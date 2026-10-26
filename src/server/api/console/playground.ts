import { Hono } from "hono";
import {
  errorResponse,
  GatewayError,
  readChatRequest,
  resolveModel,
  runChat,
} from "../../gateway/runtime";
import { currentUser, requireUser } from "./session";
import type { ApiEnv } from "../types";

/**
 * 画面からモデルを試す。ログイン中の人のクレジットで払う。
 * 返し方は /v1/chat/completions と同じ。
 */
const playground = new Hono<ApiEnv>();

playground.use("/playground/*", requireUser());

playground.post("/playground/chat", async (c) => {
  const userId = currentUser(c).id;
  try {
    const request = await readChatRequest(c.req.raw);
    const { model, config } = await resolveModel(c.env, request.model, userId);
    return await runChat(
      {
        env: c.env,
        waitUntil: (promise) => c.executionCtx.waitUntil(promise),
        model,
        config,
        consumerUserId: userId,
        apiKeyId: null,
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
