import { Hono } from "hono";
import { auth } from "@/lib/auth/server";
import type { ApiEnv } from "./types";

const authApi = new Hono<ApiEnv>();

authApi.on(["GET", "POST"], "/*", (c) => {
  return auth(c.env, new URL(c.req.url).origin).handler(c.req.raw);
});

export default authApi;

