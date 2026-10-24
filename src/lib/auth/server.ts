import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { captcha, organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { recordAuditLog, type AuditAction } from "../organization/audit";
import { getDb } from "../db/client";
import { detectLocale, translate } from "../i18n";
import { leaveOrganizationsForDeletion } from "../organization/cleanup";
import { retireOrganizationModels } from "../compute/retire";
import * as schema from "../db/schema";

const MEMBER_AUDIT_PATHS: Record<string, AuditAction> = {
  "/organization/remove-member": "member.remove",
  "/organization/update-member-role": "member.role_update",
  "/organization/leave": "member.leave",
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEmail({
  locale,
  heading,
  body,
  buttonLabel,
  url,
  footer,
}: {
  locale: Locale;
  heading: string;
  body: string;
  buttonLabel: string;
  url: string;
  footer: string;
}) {
  const text = [heading, "", body, url, "", footer].join("\n");
  const html = `
    <!doctype html>
    <html lang="${locale}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(heading)}</title>
      </head>
      <body style="margin:0;background:#f5f5f5;color:#262626;font-family:Arial,'Noto Sans JP',sans-serif;">
        <div style="max-width:560px;margin:0 auto;padding:40px 20px;">
          <div style="border:1px solid #e5e5e5;border-radius:12px;background:#ffffff;padding:32px;">
            <p style="margin:0 0 24px;font-size:20px;font-weight:700;">Forkline</p>
            <h1 style="margin:0 0 16px;font-size:24px;line-height:1.4;">${escapeHtml(heading)}</h1>
            <p style="margin:0 0 24px;color:#525252;font-size:15px;line-height:1.8;">
              ${escapeHtml(body)}
            </p>
            <a href="${url}" style="display:inline-block;border-radius:8px;background:#155eef;color:#ffffff;padding:12px 20px;text-decoration:none;font-size:15px;font-weight:700;">
              ${escapeHtml(buttonLabel)}
            </a>
            <p style="margin:24px 0 0;color:#737373;font-size:13px;line-height:1.7;">
              ${escapeHtml(footer)}
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
  return { text, html };
}

/** Turnstile を外すのは、キーが空で、しかも http:// (手元) のときだけ */
export function turnstileDisabled(env: Pick<CloudflareEnv, "TURNSTILE_SECRET_KEY">, baseURL: string) {
  if (env.TURNSTILE_SECRET_KEY?.trim()) return false;
  if (!baseURL.startsWith("http://")) {
    throw new Error("TURNSTILE_SECRET_KEY が設定されていません");
  }
  return true;
}

function createAuth(env: CloudflareEnv, requestOrigin?: string) {
  const baseURL = requestOrigin || env.VITE_PUBLIC_APP_URL;
  const emailFrom = env.AUTH_EMAIL_FROM;

  return betterAuth({
    appName: "Forkline",
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    database: drizzleAdapter(getDb(env), {
      provider: "mysql",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }, request) {
        const locale = detectLocale(request);
        await env.EMAIL.send({
          from: emailFrom,
          to: user.email,
          subject: translate(locale, "email.reset.subject"),
          ...renderEmail({
            locale,
            heading: translate(locale, "email.reset.heading"),
            body: translate(locale, "email.reset.body"),
            buttonLabel: translate(locale, "email.reset.button"),
            url,
            footer: translate(locale, "email.reset.footer"),
          }),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      async sendVerificationEmail({ user, url }, request) {
        const locale = detectLocale(request);
        await env.EMAIL.send({
          from: emailFrom,
          to: user.email,
          subject: translate(locale, "email.verify.subject"),
          ...renderEmail({
            locale,
            heading: translate(locale, "email.verify.heading"),
            body: translate(locale, "email.verify.body"),
            buttonLabel: translate(locale, "email.verify.button"),
            url,
            footer: translate(locale, "email.verify.footer"),
          }),
        });
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        prompt: "select_account",
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        async beforeDelete(user, request) {
          await leaveOrganizationsForDeletion(env, user.id, request);
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
    advanced: {
      database: {
        generateId: "uuid",
      },
      cookies: {
        session_token: {
          name: "forkline_session",
          options: {
            httpOnly: true,
            secure: !baseURL.startsWith("http://localhost"),
            sameSite: "lax",
          },
        },
      },
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    plugins: [
      // 手元の開発 (http://) では TURNSTILE_SECRET_KEY を空にすれば外せる。公開先 (https://) では必ず使う
      captcha({
        provider: "cloudflare-turnstile",
        allowedHostnames: [new URL(baseURL).hostname],
        // 外すときは確かめる経路を外す (プラグイン自体は残して型を保つ。キーが空だと先に止まるので仮の値を渡す)
        ...(turnstileDisabled(env, baseURL)
          ? // 空の配列は既定の経路に戻されるので、どこにも当たらない経路だけを指定する
            { secretKey: "disabled-in-local-development", endpoints: ["/__captcha-disabled-in-local-development"] }
          : { secretKey: env.TURNSTILE_SECRET_KEY }),
      }),
      organization({
        allowUserToCreateOrganization: true,
        organizationLimit: 10,
        async sendInvitationEmail(data, request) {
          const locale = detectLocale(request);
          const url = `${baseURL}/accept-invitation/${data.id}`;
          const inviterName = data.inviter.user.name || data.inviter.user.email;
          await env.EMAIL.send({
            from: emailFrom,
            to: data.email,
            subject: translate(locale, "email.invitation.subject", {
              organization: data.organization.name,
            }),
            ...renderEmail({
              locale,
              heading: translate(locale, "email.invitation.heading"),
              body: translate(locale, "email.invitation.body", {
                inviter: inviterName,
                organization: data.organization.name,
              }),
              buttonLabel: translate(locale, "email.invitation.button"),
              url,
              footer: translate(locale, "email.invitation.footer"),
            }),
          });
        },
        organizationHooks: {
          async afterCreateOrganization({ organization, user }) {
            await recordAuditLog(env, {
              organizationId: organization.id,
              actor: { id: user.id, name: user.name, email: user.email },
              action: "organization.create",
              targetId: organization.id,
              targetLabel: organization.name,
            });
          },
          async afterUpdateOrganization({ organization, user, member }) {
            await recordAuditLog(env, {
              organizationId: member.organizationId,
              actor: { id: user.id, name: user.name, email: user.email },
              action: "organization.update",
              targetId: member.organizationId,
              targetLabel: organization?.name ?? "",
            });
          },
          async afterDeleteOrganization({ organization, user }) {
            await retireOrganizationModels(env, organization.id).catch((error) =>
              console.error("組織のモデルを片付けられませんでした:", organization.id, error),
            );
            await recordAuditLog(env, {
              organizationId: organization.id,
              actor: { id: user.id, name: user.name, email: user.email },
              action: "organization.delete",
              targetId: organization.id,
              targetLabel: organization.name,
            });
          },
          async afterCreateInvitation({ invitation, inviter }) {
            await recordAuditLog(env, {
              organizationId: invitation.organizationId,
              actor: {
                id: inviter.id,
                name: inviter.name,
                email: inviter.email,
              },
              action: "invitation.create",
              targetLabel: invitation.email,
              metadata: { role: invitation.role },
            });
          },
          async afterAcceptInvitation({ invitation, member, user }) {
            await recordAuditLog(env, {
              organizationId: invitation.organizationId,
              actor: { id: user.id, name: user.name, email: user.email },
              action: "invitation.accept",
              targetId: user.id,
              targetLabel: invitation.email,
              metadata: { role: member.role },
            });
          },
          async afterRejectInvitation({ invitation, user }) {
            await recordAuditLog(env, {
              organizationId: invitation.organizationId,
              actor: { id: user.id, name: user.name, email: user.email },
              action: "invitation.reject",
              targetLabel: invitation.email,
            });
          },
          async afterCancelInvitation({ invitation, cancelledBy }) {
            await recordAuditLog(env, {
              organizationId: invitation.organizationId,
              actor: {
                id: cancelledBy.id,
                name: cancelledBy.name,
                email: cancelledBy.email,
              },
              action: "invitation.cancel",
              targetLabel: invitation.email,
            });
          },
        },
      }),
    ],
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const action = MEMBER_AUDIT_PATHS[ctx.path];
        if (!action) return;

        const returned = ctx.context.returned;
        const record = (
          returned && typeof returned === "object" && "member" in returned
            ? (returned as { member: unknown }).member
            : returned
        ) as {
          userId?: string;
          organizationId?: string;
          role?: string;
        } | null;
        if (!record?.userId || !record.organizationId) return;

        const session = await getSessionFromCtx(ctx);
        if (!session) return;

        const [affected] = await getDb(env)
          .select({ name: schema.user.name, email: schema.user.email })
          .from(schema.user)
          .where(eq(schema.user.id, record.userId))
          .limit(1);

        await recordAuditLog(env, {
          organizationId: record.organizationId,
          actor: {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
          },
          action,
          targetId: record.userId,
          targetLabel: affected?.email || record.userId,
          metadata:
            action === "member.role_update" ? { role: record.role } : {},
        });
      }),
    },
  });
}

export const auth = (env: CloudflareEnv, requestOrigin?: string) =>
  createAuth(env, requestOrigin);
