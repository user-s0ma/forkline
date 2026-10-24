/** Nebius を使うのに要る環境変数 */
export type NebiusEnv = {
  /**
   * Nebius AI Cloud の IAM アクセストークン (`nebius iam get-access-token`、12 時間で切れる)。
   * 手元の確認用。本番はサービスアカウントの 3 つを使う (そちらがあれば優先)
   */
  NEBIUS_API_KEY?: string;
  /** サービスアカウントの ID (serviceaccount-...) */
  NEBIUS_SERVICE_ACCOUNT_ID?: string;
  /** サービスアカウントの authorized key の ID */
  NEBIUS_AUTHORIZED_KEY_ID?: string;
  /** authorized key の秘密鍵 (PEM。PKCS#8 か PKCS#1、改行は \n でもよい) */
  NEBIUS_AUTHORIZED_PRIVATE_KEY?: string;
  /** ジョブとエンドポイントを作るプロジェクト */
  NEBIUS_PROJECT_ID: string;
  /** 例: eu-north1 */
  NEBIUS_REGION: string;
  /** ジョブとエンドポイントの VM を置くサブネット。省略するとプロジェクトの既定 */
  NEBIUS_SUBNET_ID?: string;
  /** 省略時は https://api.nebius.cloud */
  NEBIUS_API_BASE_URL?: string;
  /** 学習データと LoRA を置く Object Storage (S3 互換)。例: https://storage.eu-north1.nebius.cloud */
  NEBIUS_S3_ENDPOINT: string;
  NEBIUS_S3_BUCKET: string;
  NEBIUS_S3_ACCESS_KEY_ID: string;
  NEBIUS_S3_SECRET_ACCESS_KEY: string;
  /** 学習ジョブのイメージ (nebius-workers/train をビルドしたもの) */
  NEBIUS_TRAIN_IMAGE?: string;
  /** 推論エンドポイントのイメージ (nebius-workers/serve をビルドしたもの) */
  NEBIUS_SERVE_IMAGE?: string;
  /** Hugging Face のトークン (ゲート付きモデルを使うときだけ) */
  NEBIUS_HF_TOKEN?: string;
  /** Token Factory (Nemotron をそのまま呼ぶとき) */
  NEBIUS_TOKEN_FACTORY_API_KEY: string;
  /** 省略時は https://api.tokenfactory.nebius.com/v1 */
  NEBIUS_TOKEN_FACTORY_BASE_URL?: string;
};

/** 微調整できる Nemotron。id は Hugging Face のリポジトリ名 */
export type NemotronBaseModel = {
  id: string;
  label: string;
  /** 学習と推論に使う GPU。"プラットフォーム/プリセット" (例: gpu-h100-sxm/1gpu-16vcpu-200gb) */
  trainPreset: string;
  servePreset: string;
  /** 1 時間あたりのおおよその料金 (USD、オンデマンド、2026-10-08 の価格表) */
  trainUsdPerHour: number;
  serveUsdPerHour: number;
  /** 推論サーバーが1回に扱えるトークン数 (入力と出力の合計) */
  maxContextTokens: number;
};

export type FineTuneHyperparameters = {
  epochs: number;
  learningRate: number;
  loraRank: number;
  loraAlpha: number;
};

export type FineTuneStatus =
  | { state: "queued" | "running" }
  | { state: "succeeded"; adapterUri: string }
  | { state: "failed"; error: string };

export type EndpointStatus =
  | { state: "starting" | "stopping" | "stopped" }
  | { state: "running"; url: string }
  | { state: "failed"; error: string };

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatUsage = { inputTokens: number; outputTokens: number };
