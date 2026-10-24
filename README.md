# Forkline

**Fine-tune Nemotron on Nebius, publish your model, and earn every time someone calls it.**

Forkline is a marketplace for fine-tuned models. A creator uploads a chat dataset, Forkline fine-tunes an NVIDIA Nemotron model with LoRA on Nebius, serves it on a Nebius endpoint, and lists it in a public store. Anyone with credits can call it through an OpenAI-compatible API, and the creator earns per token.

## How it works

1. **Train** – Pick a Nemotron base model, upload a chat-format JSONL dataset (or paste an FAQ, manual or policy and let Nemotron on **Nebius Token Factory** turn it into reviewed chat examples) and start training. A share of the examples is held out for evaluation. Forkline stores the dataset in Nebius Object Storage and runs LoRA fine-tuning as a **Nebius Serverless AI Job**.
2. **Deploy** – Forkline starts a **Nebius Serverless AI Endpoint** that serves the base model plus your adapter with vLLM.
3. **Test** – Try the model in the in-browser playground, and run an automatic evaluation: each held-out question goes to your endpoint and to the base Nemotron on Token Factory, and Nemotron grades both against the reference answer (1–5). Forkline reports average scores, win rate, a sign test and a bootstrap interval, says plainly when the sample is too small, and shows the result on the store page as "Evaluated by Nemotron". Nemotron can also draft the model card for you to edit.
4. **Publish** – Set a price per input/output token and per request, then publish to the store.
5. **Earn** – Consumers call `https://forkline.ai/v1/chat/completions` with an API key. Each call is charged from their prepaid credits; the creator receives the creator price minus the platform fee (20%) and is paid out through Stripe Connect.

Idle endpoints are stopped automatically (default: 15 minutes without calls), so the creator only pays for GPU time that is actually used. A call to a stopped model starts it again and returns `503 model_warming_up` with `Retry-After` until it is ready.

## Nebius and NVIDIA

| What | Where |
|---|---|
| LoRA fine-tuning | Nebius Serverless AI **Jobs** (`POST /ai/v1/jobs`), image in `nebius-workers/train` (PEFT + TRL) |
| Inference | Nebius Serverless AI **Endpoints** (`POST /ai/v1/endpoints`), image in `nebius-workers/serve` (vLLM with `--enable-lora`) |
| Datasets and adapters | Nebius Object Storage (S3 compatible) |
| Base models | `nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16` (default, 1× L40S) and `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16` (H200 to train, H100 to serve) |
| Dataset builder, baseline, grader, model card draft | Nemotron on Nebius Token Factory (OpenAI-compatible), prompts in `src/lib/nemotron/prompts.ts` |

The integration lives in `src/lib/nebius/`. Details on the container images are in [`nebius-workers/README.md`](nebius-workers/README.md).

## Using a model

```bash
curl https://forkline.ai/v1/chat/completions \
  -H "Authorization: Bearer fk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<model-slug>",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

`GET /v1/models` lists the published models and your organization's own models. Any OpenAI SDK works by setting the base URL to `https://forkline.ai/v1`.

## Organizations and billing

- Models, credits, API keys and earnings belong to an **organization**. Members can train, deploy and test; owners and admins manage API keys, credits, payouts and publishing. Important actions are recorded in the audit log.
- Credits are bought with Stripe Checkout. All amounts are integers in micro-yen (1 yen = 1,000,000).
- Training holds 1.5× the estimated cost when it starts and settles the actual GPU time when it ends. Running endpoints are billed every minute to the organization that owns the model.
- GPU rates, markup, exchange rate and idle timeout are in `src/lib/billing/compute.ts` and `src/lib/nebius/models.ts`. Check them against current Nebius pricing before running in production.
- Token Factory calls (dataset builder, evaluation, model card) hold an estimate before each call and settle the actual tokens afterwards, at the per-token rate in `src/lib/billing/compute.ts`.
- Each model call holds the most it can cost (per-request price, the request size as input tokens, and the model's output limit as `max_tokens`) and is never charged more than that. A stream cut off before the final usage is charged from what was streamed.
- Creator earnings can be paid out `EARNINGS_HOLD_DAYS` days (default 7) after they are earned. Refunds and chargebacks of credit purchases are taken back from the organization's credits, which may go negative and then block usage.
- Only owners and admins can change a model's runtime settings (the output token limit) and prices.

## Tech stack

React Router 8 and Hono on Cloudflare Workers, TiDB Serverless (MySQL) with Drizzle, better-auth (email/password, Google, organizations), Cloudflare Turnstile, Stripe and Stripe Connect, i18n (Japanese and English).

## Setup

Requirements: Node.js 22, a Cloudflare account, a TiDB Serverless database, a Stripe account, and a Nebius AI Cloud project.

1. **Install**
   ```bash
   npm install
   ```
2. **Configure** – Copy `.dev.vars.example` to `.dev.vars` and fill in the values. In production, set the same values with `wrangler secret put`. `SECRET_ENCRYPTION_KEY` encrypts the stored Nebius endpoint tokens; changing it makes existing tokens unreadable.
3. **Database**
   ```bash
   npm run db:migrate
   ```
4. **Nebius**
   - Create a service account with an authorized key and access to Serverless AI and Object Storage, and an Object Storage bucket and access key.
   - Build and push the images in `nebius-workers/` to Nebius Container Registry, then set `NEBIUS_TRAIN_IMAGE` and `NEBIUS_SERVE_IMAGE`.
5. **Stripe** – Create a webhook to `/api/stripe/webhook` and set `STRIPE_WEBHOOK_SECRET`. Enable Connect for payouts.
6. **Run locally**
   ```bash
   npm run dev
   ```
7. **Deploy**
   ```bash
   npm run deploy
   ```
   `wrangler.jsonc` defines the R2 bucket, the email binding and a cron trigger that runs every minute (training status, endpoint billing and idle stop).

## Development

```bash
npm run type-check
npm run lint
npm test
```

| Path | Contents |
|---|---|
| `src/lib/nebius/` | Nebius Serverless AI, Object Storage and Token Factory client |
| `src/lib/compute/` | Fine-tune and endpoint lifecycle, credit holds and settlement |
| `src/lib/nemotron/` | Dataset builder, evaluation and model card with Nemotron on Token Factory |
| `src/lib/billing/` | Wallet and ledger, pricing, Stripe, API keys |
| `src/workers/gateway/` | OpenAI-compatible API (`/v1`) |
| `src/workers/api/` | Console and store API |
| `src/workers/scheduled.ts` | Cron: training status, endpoint billing, idle stop |
| `src/app/` | Pages (landing, store, docs, console) |
| `nebius-workers/` | Training and serving container images |
| `drizzle/` | Database migrations |

## License

[Apache License 2.0](LICENSE). The license does not grant rights to the Forkline name or logo.
