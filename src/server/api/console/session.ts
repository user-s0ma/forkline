import type { Context, MiddlewareHandler } from "hono";
import { auth } from "@/lib/auth/server";
import { detectLocale, translate } from "@/lib/i18n";
import type { ApiEnv, SessionUser } from "../types";

/** ログインしている人だけを通す。モデル・学習・残高・キーは、その人のものだけを扱う */
export function requireUser(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const session = await auth(c.env, new URL(c.req.url).origin).api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session) {
      return c.json(
        { message: translate(detectLocale(c.req.raw), "server.common.loginRequired") },
        401,
      );
    }
    c.set("user", {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    });
    await next();
  };
}

export function currentUser(c: Context<ApiEnv>): SessionUser {
  return c.get("user");
}
