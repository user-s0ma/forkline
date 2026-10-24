/**
 * LoRA の微調整。学習データは Object Storage に置き、学習は Serverless AI の Job で動かす。
 * Job の REST: https://docs.nebius.com/serverless/jobs/manage.md 、状態: https://docs.nebius.com/serverless/lifecycle.md
 */
import type { FineTuneHyperparameters, FineTuneStatus, NebiusEnv } from "./types";
import { assertResourceId, nebiusApi, operationResourceId, type NebiusOperation } from "./api";
import { NebiusError, randomHex, requireString } from "./http";
import { findModel, splitPreset } from "./models";
import { isSafeKey, parseS3Uri, s3Config, s3Exists, s3Put, s3Uri } from "./s3";

/** 学習データの上限 (Workers のメモリに収まる大きさ) */
export const MAX_TRAINING_BYTES = 50 * 1024 * 1024;
export const MAX_TRAINING_LINES = 100_000;

const TRAIN_COMMAND = "python3 /opt/forkline/train.py";

/** chat 形式の JSONL を 1 行ずつ確かめる。だめなら何行目かを示す */
export function validateChatJsonl(jsonl: string): number {
  if (typeof jsonl !== "string" || jsonl.trim() === "") {
    throw new NebiusError("学習データが空です");
  }
  if (new TextEncoder().encode(jsonl).length > MAX_TRAINING_BYTES) {
    throw new NebiusError("学習データが大きすぎます (50MB まで)");
  }
  const lines = jsonl.split(/\r?\n/);
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    const where = `学習データの ${i + 1} 行目`;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      throw new NebiusError(`${where}が JSON として読めません`);
    }
    const messages = (row as { messages?: unknown } | null)?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new NebiusError(`${where}に messages の配列がありません`);
    }
    let hasAssistant = false;
    for (const m of messages) {
      const role = (m as { role?: unknown } | null)?.role;
      const content = (m as { content?: unknown } | null)?.content;
      if (role !== "system" && role !== "user" && role !== "assistant") {
        throw new NebiusError(`${where}の role は system / user / assistant のどれかにしてください`);
      }
      if (typeof content !== "string") {
        throw new NebiusError(`${where}の content が文字列ではありません`);
      }
      if (role === "assistant") hasAssistant = true;
    }
    if (!hasAssistant) {
      throw new NebiusError(`${where}に assistant の発言がありません`);
    }
    count++;
    if (count > MAX_TRAINING_LINES) {
      throw new NebiusError(`学習データは ${MAX_TRAINING_LINES} 行までです`);
    }
  }
  if (count === 0) throw new NebiusError("学習データが空です");
  return count;
}

export async function uploadTrainingData(
  env: NebiusEnv,
  input: { key: string; jsonl: string },
): Promise<{ datasetUri: string }> {
  if (typeof input?.key !== "string" || !isSafeKey(input.key)) {
    throw new NebiusError("学習データの保存先のキーが正しくありません (英数字と . _ - / のみ)");
  }
  validateChatJsonl(input.jsonl);
  const { bucket } = s3Config(env);
  await s3Put(env, input.key, input.jsonl, "application/x-ndjson");
  return { datasetUri: s3Uri(bucket, input.key) };
}

export function validateHyperparameters(h: FineTuneHyperparameters): void {
  if (!h || typeof h !== "object") throw new NebiusError("学習の設定がありません");
  if (!Number.isInteger(h.epochs) || h.epochs < 1 || h.epochs > 20) {
    throw new NebiusError("epochs は 1 から 20 の整数にしてください");
  }
  if (typeof h.learningRate !== "number" || !(h.learningRate >= 1e-6 && h.learningRate <= 1e-2)) {
    throw new NebiusError("learningRate は 0.000001 から 0.01 の間にしてください");
  }
  if (![4, 8, 16, 32, 64].includes(h.loraRank)) {
    throw new NebiusError("loraRank は 4, 8, 16, 32, 64 のどれかにしてください");
  }
  if (!Number.isInteger(h.loraAlpha) || h.loraAlpha < 1 || h.loraAlpha > 256) {
    throw new NebiusError("loraAlpha は 1 から 256 の整数にしてください");
  }
}

/** outputPrefix (キーか s3:// の URI) をキーに揃える。末尾の / は付けない */
function normalizeOutputPrefix(prefix: unknown, bucket: string): string {
  if (typeof prefix !== "string" || prefix.trim() === "") {
    throw new NebiusError("LoRA の保存先が指定されていません");
  }
  const key = prefix.startsWith("s3://") ? parseS3Uri(prefix, bucket, "LoRA の保存先") : prefix;
  const trimmed = key.replace(/\/+$/, "");
  if (!isSafeKey(trimmed)) {
    throw new NebiusError("LoRA の保存先のパスが正しくありません");
  }
  return trimmed;
}

export function gib(n: number): string {
  return String(n * 1024 * 1024 * 1024);
}

/** S3 の鍵と HF トークンは環境変数で渡す (args は GET で読めるので秘密を入れない) */
export function workerEnvironment(env: NebiusEnv): { name: string; value: string }[] {
  const cfg = s3Config(env);
  const vars = [
    { name: "S3_ENDPOINT", value: cfg.endpoint },
    { name: "S3_REGION", value: cfg.region },
    { name: "AWS_ACCESS_KEY_ID", value: cfg.accessKeyId },
    { name: "AWS_SECRET_ACCESS_KEY", value: cfg.secretAccessKey },
  ];
  const hf = env.NEBIUS_HF_TOKEN?.trim();
  if (hf) vars.push({ name: "HF_TOKEN", value: hf });
  return vars;
}

export async function startFineTune(
  env: NebiusEnv,
  input: {
    baseModelId: string;
    datasetUri: string;
    outputPrefix: string;
    hyperparameters: FineTuneHyperparameters;
  },
): Promise<{ jobId: string }> {
  const model = findModel(input?.baseModelId);
  if (!model) throw new NebiusError("このベースモデルは微調整に対応していません");
  const { bucket } = s3Config(env);
  const datasetKey = parseS3Uri(input.datasetUri, bucket, "学習データの URI");
  const outputKey = normalizeOutputPrefix(input.outputPrefix, bucket);
  validateHyperparameters(input.hyperparameters);
  const image = requireString(env.NEBIUS_TRAIN_IMAGE, "NEBIUS_TRAIN_IMAGE");
  const h = input.hyperparameters;

  // Nebius は args を空白で区切って渡す。値に空白が入らないことは上で確かめている
  const args = [
    "--base-model", model.id,
    "--dataset-uri", s3Uri(bucket, datasetKey),
    "--output-uri", s3Uri(bucket, outputKey),
    "--epochs", String(h.epochs),
    "--learning-rate", String(h.learningRate),
    "--lora-rank", String(h.loraRank),
    "--lora-alpha", String(h.loraAlpha),
    "--target-modules", model.loraTargetModules.join(","),
    "--max-seq-len", String(model.trainMaxSeqLen),
  ].join(" ");

  const spec: Record<string, unknown> = {
    image,
    containerCommand: TRAIN_COMMAND,
    args,
    environmentVariables: workerEnvironment(env),
    ...splitPreset(model.trainPreset),
    timeout: `${model.trainTimeoutSeconds}s`,
    restartAttempts: "0",
    disk: { type: "NETWORK_SSD", sizeBytes: gib(model.trainDiskGib) },
  };
  const subnet = env.NEBIUS_SUBNET_ID?.trim();
  if (subnet) spec.subnetId = subnet;

  const op = await nebiusApi<NebiusOperation>(env, "POST", "/ai/v1/jobs", {
    metadata: {
      parentId: requireString(env.NEBIUS_PROJECT_ID, "NEBIUS_PROJECT_ID"),
      name: `forkline-ft-${randomHex(6)}`,
    },
    spec,
  });
  return { jobId: operationResourceId(op, "ジョブ") };
}

type JobResource = {
  spec?: { args?: string };
  status?: { state?: string; stateDetails?: { code?: string; message?: string } };
};

function stateMessage(details: { code?: string; message?: string } | undefined, fallback: string): string {
  const parts = [details?.code, details?.message].filter((s) => typeof s === "string" && s !== "");
  return parts.length > 0 ? `${fallback} (${parts.join(": ").slice(0, 300)})` : fallback;
}

export async function getFineTune(env: NebiusEnv, jobId: string): Promise<FineTuneStatus> {
  const id = assertResourceId(jobId, "ジョブ");
  const job = await nebiusApi<JobResource>(env, "GET", `/ai/v1/jobs/${encodeURIComponent(id)}`);
  const state = job.status?.state ?? "STATE_UNSPECIFIED";
  switch (state) {
    case "RUNNING":
      return { state: "running" };
    case "COMPLETED": {
      const { bucket } = s3Config(env);
      const outputUri = /(?:^|\s)--output-uri\s+(\S+)/.exec(job.spec?.args ?? "")?.[1];
      if (!outputUri) {
        return { state: "failed", error: "ジョブの設定から LoRA の保存先を読めませんでした" };
      }
      const key = parseS3Uri(outputUri, bucket, "LoRA の保存先");
      // 学習スクリプトは最後に adapter_config.json を書く。無ければ失敗とみなす
      if (!(await s3Exists(env, `${key}/adapter_config.json`))) {
        return { state: "failed", error: "学習は終わりましたが LoRA のファイルが見つかりません" };
      }
      return { state: "succeeded", adapterUri: outputUri };
    }
    case "FAILED":
      return { state: "failed", error: stateMessage(job.status?.stateDetails, "学習ジョブが失敗しました") };
    case "ERROR":
      return { state: "failed", error: stateMessage(job.status?.stateDetails, "Nebius 側のエラーで学習ジョブが止まりました") };
    case "CANCELLING":
    case "CANCELLED":
    case "DELETING":
      return { state: "failed", error: "学習ジョブは取り消されました" };
    default:
      // STATE_UNSPECIFIED / PROVISIONING / STARTING / IMAGE_PULLING
      return { state: "queued" };
  }
}

export async function cancelFineTune(env: NebiusEnv, jobId: string): Promise<void> {
  const id = assertResourceId(jobId, "ジョブ");
  // 要確認: エンドポイントの stop/start (POST /ai/v1/endpoints/stop、本文 {id}) と同じ形と見ている
  await nebiusApi(env, "POST", "/ai/v1/jobs/cancel", { id });
}
