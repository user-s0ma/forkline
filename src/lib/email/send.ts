/**
 * メールを送る。Cloudflare Email Service の REST API を使う。
 * https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
 * 送信元 (AUTH_EMAIL_FROM) のドメインは Cloudflare で送信用に設定しておく
 */
export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
};

const API_BASE = "https://api.cloudflare.com/client/v4";

export async function sendEmail(
  env: Pick<AppEnv, "CLOUDFLARE_ACCOUNT_ID" | "CLOUDFLARE_EMAIL_API_TOKEN">,
  message: EmailMessage,
): Promise<void> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();
  if (!accountId || !token) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_EMAIL_API_TOKEN を設定してください");
  }
  const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/email/sending/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`メールを送れませんでした (${res.status} ${detail})`);
  }
}
