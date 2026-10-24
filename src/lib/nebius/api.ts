/**
 * Nebius AI Cloud の REST API (https://api.nebius.cloud) を呼ぶ。
 * 本文は proto の JSON 表現 (camelCase、int64 は文字列)。
 */
import type { NebiusEnv } from "./types";
import { getAccessToken, invalidateAccessToken } from "./auth";
import { NebiusError, errorDetail, trimSlash } from "./http";

export const DEFAULT_API_BASE_URL = "https://api.nebius.cloud";

/** 作成・停止などが返す Operation のうち使うところ */
export type NebiusOperation = { id?: string; resourceId?: string };

export async function nebiusApi<T>(
  env: NebiusEnv,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const base = trimSlash(env.NEBIUS_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL);
  const token = await getAccessToken(env);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NebiusError(`Nebius API につながりませんでした (${method} ${path})`);
  }
  if (res.status === 401) invalidateAccessToken();
  if (!res.ok) {
    const detail = await errorDetail(res, env, [token]);
    throw new NebiusError(
      `Nebius API の呼び出しに失敗しました (${method} ${path}: ${res.status}${detail ? ` ${detail}` : ""})`,
      res.status,
    );
  }
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NebiusError(`Nebius API の応答を読めませんでした (${method} ${path})`);
  }
}

/** Nebius のリソース ID (aijob-xxx、aiendpoint-xxx など) の形を確かめる */
export function assertResourceId(id: unknown, what: string): string {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{2,99}$/.test(id)) {
    throw new NebiusError(`${what}の ID が正しくありません`);
  }
  return id;
}

export function operationResourceId(op: NebiusOperation, what: string): string {
  if (typeof op.resourceId !== "string" || op.resourceId === "") {
    throw new NebiusError(`Nebius の応答に${what}の ID がありません`);
  }
  return op.resourceId;
}
