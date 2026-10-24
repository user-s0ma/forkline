import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { member } from "@/lib/db/schema";
import { detectLocale, translate } from "@/lib/i18n";
import type { ApiEnv, OrganizationAuthorization } from "../types";

type SessionIdentity = {
  user: { id: string; name: string; email: string };
};

export function resolveOrganizationAuthorization(
  session: SessionIdentity | null,
  membership: { role: string | null } | null,
): OrganizationAuthorization | { error: "unauthorized" | "forbidden" } {
  if (!session) return { error: "unauthorized" };
  if (!membership) return { error: "forbidden" };
  return {
    actor: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
    role: membership.role,
  };
}

export function hasRequiredRole(
  role: string | null | undefined,
  roles: readonly string[],
) {
  return Boolean(role && roles.includes(role));
}

export async function authorizeOrganization(
  env: CloudflareEnv,
  request: Request,
  organizationId: string,
): Promise<
  OrganizationAuthorization | { error: "unauthorized" | "forbidden" }
> {
  const session = await auth(env, new URL(request.url).origin).api.getSession({
    headers: request.headers,
  });
  if (!session) return resolveOrganizationAuthorization(null, null);

  const [membership] = await getDb(env)
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.userId, session.user.id),
      ),
    )
    .limit(1);

  return resolveOrganizationAuthorization(session, membership ?? null);
}

function authorizationError(
  error: "unauthorized" | "forbidden",
  c: Context<ApiEnv>,
) {
  const locale = detectLocale(c.req.raw);
  return error === "unauthorized"
    ? c.json({ message: translate(locale, "server.common.loginRequired") }, 401)
    : c.json(
        { message: translate(locale, "server.common.forbiddenOrganization") },
        403,
      );
}

export function organizationAuth(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const authorization = await authorizeOrganization(
      c.env,
      c.req.raw,
      c.req.param("organizationId") ?? "",
    );
    if ("error" in authorization) {
      return authorizationError(authorization.error, c);
    }
    c.set("authorization", authorization);
    await next();
  };
}

const access = new Hono<ApiEnv>();

access.get("/:organizationId/access", organizationAuth(), (c) =>
  c.json({ role: c.get("authorization").role }),
);

export default access;

export function requireRole(...roles: string[]): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const { role } = c.get("authorization");
    if (!hasRequiredRole(role, roles)) {
      return c.json(
        {
          message: translate(
            detectLocale(c.req.raw),
            "server.common.adminRequired",
          ),
        },
        403,
      );
    }
    await next();
  };
}
