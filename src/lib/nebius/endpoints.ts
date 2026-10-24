/**
 * Nemotron と LoRA を載せた vLLM を Serverless AI の Endpoint で動かす。
 * 作成: https://docs.nebius.com/serverless/endpoints/manage.md
 * 停止と再開: https://docs.nebius.com/serverless/maintenance/stop-start.md (止めている間は計算資源の料金がかからない)
 * spec の項目: https://github.com/nebius/api/blob/main/nebius/ai/v1/endpoint.proto
 */
import type { EndpointStatus, NebiusEnv } from "./types";
import { assertResourceId, nebiusApi, operationResourceId, type NebiusOperation } from "./api";
import { NebiusError, randomHex, requireString } from "./http";
import { gib, workerEnvironment } from "./finetune";
import { findModel, splitPreset } from "./models";
import { parseS3Uri, s3Config, s3Uri } from "./s3";

/** vLLM に登録する LoRA の名前。proxyChatCompletion は model をこれに置き換える */
export const LORA_MODEL_NAME = "adapter";
/** vLLM の --max-lora-rank。学習で選べる rank の最大と揃える */
export const MAX_LORA_RANK = 64;
const SERVE_PORT = 8000;
const SERVE_COMMAND = "python3 /opt/forkline/serve.py";

/**
 * 名前を Nebius のリソース名に揃える。
 * 要確認: 名前の規則。小文字英数字とハイフン、63 文字までに絞っている
 */
export function normalizeResourceName(name: unknown): string {
  if (typeof name !== "string") throw new NebiusError("エンドポイントの名前がありません");
  const out = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, 63)
    .replace(/^-+|-+$/g, "");
  if (out === "") throw new NebiusError("エンドポイントの名前には英数字を含めてください");
  return out;
}

export async function createEndpoint(
  env: NebiusEnv,
  input: { name: string; baseModelId: string; adapterUri: string },
): Promise<{ endpointId: string; authToken: string }> {
  const name = normalizeResourceName(input?.name);
  const model = findModel(input.baseModelId);
  if (!model) throw new NebiusError("このベースモデルは推論に対応していません");
  const { bucket } = s3Config(env);
  const adapterKey = parseS3Uri(input.adapterUri, bucket, "LoRA の URI").replace(/\/+$/, "");
  const image = requireString(env.NEBIUS_SERVE_IMAGE, "NEBIUS_SERVE_IMAGE");

  const args = [
    "--base-model", model.id,
    "--adapter-uri", s3Uri(bucket, adapterKey),
    "--lora-name", LORA_MODEL_NAME,
    "--max-lora-rank", String(MAX_LORA_RANK),
    "--max-model-len", String(model.serveMaxModelLen),
    "--mamba-ssm-cache-dtype", model.mambaSsmCacheDtype,
    "--port", String(SERVE_PORT),
  ].join(" ");

  // Nebius の前段がこのトークンで Bearer 認証をかける。呼び出し側で保存して proxyChatCompletion に渡す
  const authToken = randomHex(32);
  const spec: Record<string, unknown> = {
    image,
    containerCommand: SERVE_COMMAND,
    args,
    environmentVariables: workerEnvironment(env),
    ports: [{ containerPort: SERVE_PORT, protocol: "HTTP" }],
    ...splitPreset(model.servePreset),
    disk: { type: "NETWORK_SSD", sizeBytes: gib(model.serveDiskGib) },
    authToken,
  };
  const subnet = env.NEBIUS_SUBNET_ID?.trim();
  if (subnet) spec.subnetId = subnet;

  const op = await nebiusApi<NebiusOperation>(env, "POST", "/ai/v1/endpoints", {
    metadata: {
      parentId: requireString(env.NEBIUS_PROJECT_ID, "NEBIUS_PROJECT_ID"),
      name,
    },
    spec,
  });
  return { endpointId: operationResourceId(op, "エンドポイント"), authToken };
}

type EndpointResource = {
  status?: {
    state?: string;
    publicEndpoints?: string[];
    stateDetails?: { code?: string; message?: string };
  };
};

/** status.publicEndpoints から https の URL を選ぶ。古いものは IP:port だけのことがある */
export function pickPublicUrl(list: unknown): string | undefined {
  if (!Array.isArray(list)) return undefined;
  const items = list.filter((s): s is string => typeof s === "string" && s !== "");
  const https = items.find((s) => s.startsWith("https://"));
  if (https) return https.replace(/\/+$/, "");
  const other = items[0];
  if (!other) return undefined;
  return (/^https?:\/\//.test(other) ? other : `http://${other}`).replace(/\/+$/, "");
}

export async function getEndpoint(env: NebiusEnv, endpointId: string): Promise<EndpointStatus> {
  const id = assertResourceId(endpointId, "エンドポイント");
  const ep = await nebiusApi<EndpointResource>(env, "GET", `/ai/v1/endpoints/${encodeURIComponent(id)}`);
  const state = ep.status?.state ?? "STATE_UNSPECIFIED";
  switch (state) {
    case "RUNNING": {
      const url = pickPublicUrl(ep.status?.publicEndpoints);
      // URL がまだ割り当てられていなければ起動中として扱う
      return url ? { state: "running", url } : { state: "starting" };
    }
    case "STOPPING":
    case "DELETING":
      return { state: "stopping" };
    case "STOPPED":
      return { state: "stopped" };
    case "ERROR": {
      const d = ep.status?.stateDetails;
      const parts = [d?.code, d?.message].filter((s) => typeof s === "string" && s !== "");
      return {
        state: "failed",
        error: parts.length > 0 ? `エンドポイントでエラーが起きました (${parts.join(": ").slice(0, 300)})` : "エンドポイントでエラーが起きました",
      };
    }
    default:
      // STATE_UNSPECIFIED / PROVISIONING / STARTING / IMAGE_PULLING
      return { state: "starting" };
  }
}

export async function startEndpoint(env: NebiusEnv, endpointId: string): Promise<void> {
  const id = assertResourceId(endpointId, "エンドポイント");
  await nebiusApi(env, "POST", "/ai/v1/endpoints/start", { id });
}

export async function stopEndpoint(env: NebiusEnv, endpointId: string): Promise<void> {
  const id = assertResourceId(endpointId, "エンドポイント");
  await nebiusApi(env, "POST", "/ai/v1/endpoints/stop", { id });
}

export async function deleteEndpoint(env: NebiusEnv, endpointId: string): Promise<void> {
  const id = assertResourceId(endpointId, "エンドポイント");
  // 要確認: ジョブの削除 (DELETE /ai/v1/jobs/<id>) と同じ形と見ている
  await nebiusApi(env, "DELETE", `/ai/v1/endpoints/${encodeURIComponent(id)}`);
}
