/** サーバーが読む設定 (環境変数)。項目の説明は deploy/forkline.env.example */
interface AppEnv {
  VITE_PUBLIC_APP_URL: string;
  VITE_PUBLIC_TURNSTILE_SITE_KEY: string;
  DATABASE_URL: string;
  AUTH_EMAIL_FROM: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  SECRET_ENCRYPTION_KEY: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_EMAIL_API_TOKEN: string;
  ENDPOINT_IDLE_MINUTES: string;
  /** お試しのアカウントに写す、学習と評価が済んだモデルの ID */
  DEMO_SOURCE_MODEL_ID: string;
  /** お試しのアカウントに一度だけ入れるクレジット (円)。GPU を動かした分はここから引かれる */
  DEMO_CREDIT_YEN: string;
  EARNINGS_HOLD_DAYS: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_CONNECT_WEBHOOK_SECRET: string;
  NEBIUS_API_KEY: string;
  NEBIUS_PROJECT_ID: string;
  NEBIUS_REGION: string;
  NEBIUS_S3_ENDPOINT: string;
  NEBIUS_S3_BUCKET: string;
  NEBIUS_S3_ACCESS_KEY_ID: string;
  NEBIUS_S3_SECRET_ACCESS_KEY: string;
  NEBIUS_TOKEN_FACTORY_API_KEY: string;
  NEBIUS_SERVICE_ACCOUNT_ID: string;
  NEBIUS_AUTHORIZED_KEY_ID: string;
  NEBIUS_AUTHORIZED_PRIVATE_KEY: string;
  NEBIUS_TRAIN_IMAGE: string;
  NEBIUS_SERVE_IMAGE: string;
  NEBIUS_SUBNET_ID: string;
  NEBIUS_API_BASE_URL: string;
  NEBIUS_HF_TOKEN: string;
  NEBIUS_TOKEN_FACTORY_BASE_URL: string;
}

/** 応答を返したあとも続ける処理を預ける (Hono の executionCtx と同じ形) */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  props: unknown;
}
