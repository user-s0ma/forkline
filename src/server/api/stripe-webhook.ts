import { Hono } from "hono";
import Stripe from "stripe";
import {
  applyChargeRefunds,
  applyDispute,
  fulfillTopup,
  getStripe,
  syncConnectAccount,
} from "@/lib/billing/stripe";
import type { ApiEnv } from "./types";

const cryptoProvider = Stripe.createSubtleCryptoProvider();

const stripeWebhook = new Hono<ApiEnv>();

stripeWebhook.post("/webhook", async (c) => {
  const signature = c.req.header("stripe-signature");
  if (!signature) return c.json({ message: "Missing signature" }, 400);
  const payload = await c.req.text();
  const stripe = getStripe(c.env);
  // プラットフォーム用と Connect 用の2つの Webhook エンドポイントを同じURLで受ける
  // Connect 用シークレットは任意 (未設定ならプラットフォーム用のみで検証する)
  const secrets = [c.env.STRIPE_WEBHOOK_SECRET, c.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(
    (secret): secret is string => Boolean(secret),
  );

  let event: Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      event = await stripe.webhooks.constructEventAsync(
        payload,
        signature,
        secret,
        undefined,
        cryptoProvider,
      );
      break;
    } catch {
      // 次のシークレットで検証する
    }
  }
  if (!event) return c.json({ message: "Invalid signature" }, 400);

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await fulfillTopup(c.env, event.data.object);
      break;
    case "account.updated":
      await syncConnectAccount(c.env, event.data.object);
      break;
    // チャージの返金・チャージバックは、その額をクレジットから引く (マイナスになってもよい)
    case "charge.refunded":
      await applyChargeRefunds(c.env, stripe, event.data.object);
      break;
    case "charge.dispute.created":
      await applyDispute(c.env, stripe, event.data.object, "created");
      break;
    case "charge.dispute.closed":
      if (event.data.object.status === "won") {
        await applyDispute(c.env, stripe, event.data.object, "won");
      }
      break;
    default:
      break;
  }
  return c.json({ received: true });
});

export default stripeWebhook;
