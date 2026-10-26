import { Hono } from "hono";
import { cors } from "hono/cors";
import { translate } from "@/lib/i18n";
import { auth } from "@/lib/auth/server";
import { demoMayWrite, isDemoUser } from "@/lib/auth/demo";
import { loggableError } from "@/lib/billing/stripe";
import authApi from "./auth";
import og from "./og";
import apiKeys from "./console/api-keys";
import billing from "./console/billing";
import fineTunes from "./console/fine-tunes";
import models from "./console/models";
import nemotron from "./console/nemotron";
import playground from "./console/playground";
import store from "./store";
import stripeWebhook from "./stripe-webhook";
import type { ApiEnv } from "./types";

const api = new Hono<ApiEnv>();

api.use(
  "*",
  cors({
    origin: (origin, c) => {
      const appUrl = c.env.VITE_PUBLIC_APP_URL;
      return origin === appUrl ? origin : null;
    },
    credentials: true,
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

api.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
});

api.route("/api/auth", authApi);
api.route("/api/store", store);
api.route("/api/og", og);
api.route("/api/stripe", stripeWebhook);
// お試しのアカウントは、見ること・載せること・プレイグラウンドで試すことだけができる
api.use("/api/*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "OPTIONS") return next();
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/auth/") || path.startsWith("/api/stripe/")) return next();
  if (demoMayWrite(c.req.method, path)) return next();
  const session = await auth(c.env, new URL(c.req.url).origin).api.getSession({ headers: c.req.raw.headers });
  if (session && isDemoUser(session.user)) {
    return c.json({ message: translate("server.common.demoReadOnly") }, 403);
  }
  return next();
});

// ログインした人の API (モデル・学習・残高・キー)。それぞれの中で requireUser を通す
api.route("/api", models);
api.route("/api", fineTunes);
api.route("/api", nemotron);
api.route("/api", billing);
api.route("/api", apiKeys);
api.route("/api", playground);

api.onError((error, c) => {
  console.error(loggableError(error));
  return c.json(
    {
      message: translate("server.common.internalError",
      ),
    },
    500,
  );
});

api.notFound((c) =>
  c.json(
    { message: translate("server.common.notFound") },
    404,
  ),
);

export default api;
