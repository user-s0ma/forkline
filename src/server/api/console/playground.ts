import { Hono } from "hono";
import {
  errorResponse,
  GatewayError,
  readChatRequest,
  resolveModel,
  runChat,
} from "../../gateway/runtime";
import { isDemoUser } from "@/lib/auth/demo";
import { currentUser, requireUser } from "./session";
import type { ApiEnv } from "../types";

/**
 * 画面からモデルを試す。ログイン中の人のクレジットで払う。
 * 返し方は /v1/chat/completions と同じ。
 */
const playground = new Hono<ApiEnv>();

playground.use("/playground/*", requireUser());

playground.post("/playground/chat", async (c) => {
  const user = currentUser(c);
  const userId = user.id;
  try {
    const request = await readChatRequest(c.req.raw);
    const { model, config } = await resolveModel(c.env, request.model, userId);
    // お試しのクレジットは本物のお金ではないので、ほかの人のモデル (売上が出る) には使わせない
    if (isDemoUser(user) && model.userId !== userId) {
      throw new GatewayError(403, "demo_own_models_only", "The demo account can only try its own model");
    }
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
