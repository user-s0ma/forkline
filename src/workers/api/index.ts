import { Hono } from "hono";
import { cors } from "hono/cors";
import { detectLocale, translate } from "@/lib/i18n";
import { loggableError } from "@/lib/billing/stripe";
import authApi from "./auth";
import og from "./og";
import access from "./organizations/access";
import apiKeys from "./organizations/api-keys";
import auditLogs from "./organizations/audit-logs";
import billing from "./organizations/billing";
import fineTunes from "./organizations/fine-tunes";
import models from "./organizations/models";
import nemotron from "./organizations/nemotron";
import playground from "./organizations/playground";
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
api.route("/api/organizations", access);
api.route("/api/organizations", auditLogs);
api.route("/api/organizations", models);
api.route("/api/organizations", fineTunes);
api.route("/api/organizations", nemotron);
api.route("/api/organizations", billing);
api.route("/api/organizations", apiKeys);
api.route("/api/organizations", playground);
api.route("/api/store", store);
api.route("/api/og", og);
api.route("/api/stripe", stripeWebhook);

api.onError((error, c) => {
  console.error(loggableError(error));
  return c.json(
    {
      message: translate(
        detectLocale(c.req.raw),
        "server.common.internalError",
      ),
    },
    500,
  );
});

api.notFound((c) =>
  c.json(
    { message: translate(detectLocale(c.req.raw), "server.common.notFound") },
    404,
  ),
);

export default api;
