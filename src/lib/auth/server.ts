import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { captcha } from "better-auth/plugins";
import { getDb } from "../db/client";
import { detectLocale, translate } from "../i18n";
import { retireUserModels } from "../compute/retire";
import { sendEmail } from "../email/send";
import * as schema from "../db/schema";
import { DEMO_EMAIL, DEMO_NAME, prepareDemoAccount } from "./demo";

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
export function turnstileDisabled(env: Pick<AppEnv, "TURNSTILE_SECRET_KEY">, baseURL: string) {
  if (env.TURNSTILE_SECRET_KEY?.trim()) return false;
  if (!baseURL.startsWith("http://")) {
    throw new Error("TURNSTILE_SECRET_KEY が設定されていません");
  }
  return true;
}

/** お試しの共有アカウントでも使える認証の経路。ほかの経路 (パスワードやメールの変更、退会、セッションの一覧・取り消し) は止める */
const DEMO_ALLOWED_PATHS = new Set(["/get-session", "/sign-out", "/sign-in/demo"]);

/**
 * お試しの共有アカウントに入る経路。共有アカウントはパスワードを持たないので、ほかの経路からは入れない。
 * 初めて使われたときにアカウントを作り、モデルの写しとクレジットを用意する
 */
function demoSignIn(env: AppEnv) {
  return {
    id: "demo",
    endpoints: {
      signInDemo: createAuthEndpoint("/sign-in/demo", { method: "POST" }, async (ctx) => {
        const adapter = ctx.context.internalAdapter;
        const found = await adapter.findUserByEmail(DEMO_EMAIL);
        const demoUser =
          found?.user ??
          (await adapter.createUser({ email: DEMO_EMAIL, name: DEMO_NAME, emailVerified: true, createdAt: new Date(), updatedAt: new Date() }));
        await prepareDemoAccount(env, demoUser.id);
        const session = await adapter.createSession(demoUser.id);
        await setSessionCookie(ctx, { session, user: demoUser });
        return ctx.json({ ok: true });
      }),
    },
    hooks: {
      before: [
        {
          matcher: (ctx: { path?: string }) => !DEMO_ALLOWED_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const current = await getSessionFromCtx(ctx, { disableRefresh: true });
            if (current?.user.email === DEMO_EMAIL) {
              throw new APIError("FORBIDDEN", { message: "The demo account cannot change account settings." });
            }
          }),
        },
      ],
    },
  };
}

function createAuth(env: AppEnv, requestOrigin?: string) {
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
        await sendEmail(env, {
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
        await sendEmail(env, {
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
        async beforeDelete(user) {
          await retireUserModels(env, user.id);
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
        ipAddressHeaders: ["x-real-ip"],
      },
    },
    plugins: [
      demoSignIn(env),
      // 手元の開発 (http://) では TURNSTILE_SECRET_KEY を空にすれば外せる。公開先 (https://) では必ず使う
      captcha({
        provider: "cloudflare-turnstile",
        allowedHostnames: [new URL(baseURL).hostname],
        // 外すときは確かめる経路を外す (プラグイン自体は残して型を保つ。キーが空だと先に止まるので仮の値を渡す)
        ...(turnstileDisabled(env, baseURL)
          ? // 空の配列は既定の経路に戻されるので、どこにも当たらない経路だけを指定する
            { secretKey: "disabled-in-local-development", endpoints: ["/__captcha-disabled-in-local-development"] }
          : {
              secretKey: env.TURNSTILE_SECRET_KEY,
              // 既定の経路 (登録・ログイン・パスワードの再設定) に、お試しの入口を足す
              endpoints: ["/sign-up/email", "/sign-in/email", "/request-password-reset", "/sign-in/demo"],
            }),
      }),
    ],
  });
}

export const auth = (env: AppEnv, requestOrigin?: string) =>
  createAuth(env, requestOrigin);
