// メール送信の中継。Nebius の VM で動く Forkline から受け取り、Cloudflare の send_email で送る。
// 本体の EMAIL バインディング (env.EMAIL.send) と同じ形の JSON を受け取る。
// 合言葉は `npx wrangler secret put RELAY_SECRET` で入れ、Forkline の MAIL_RELAY_SECRET と揃える。
export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const auth = request.headers.get("Authorization") ?? "";
    if (!env.RELAY_SECRET || !(await same(auth, `Bearer ${env.RELAY_SECRET}`))) {
      return new Response("Unauthorized", { status: 401 });
    }
    let message;
    try {
      message = await request.json();
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    const { from, to, subject, html, text } = message ?? {};
    if (typeof to !== "string" || typeof subject !== "string" || (typeof html !== "string" && typeof text !== "string")) {
      return new Response("Bad Request", { status: 400 });
    }
    // 送り主は Forkline の送信元に限る
    if (from !== env.AUTH_EMAIL_FROM) return new Response("Forbidden sender", { status: 403 });
    try {
      await env.EMAIL.send({ from, to, subject, html, text });
    } catch (error) {
      console.error("send failed", error);
      return new Response("Send failed", { status: 502 });
    }
    return new Response(null, { status: 204 });
  },
};

/** 合言葉を比べる (長さと中身で時間が変わらないよう、ハッシュどうしを比べる) */
async function same(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(x, y);
}
