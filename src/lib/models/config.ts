import { z } from "zod";
import { MODEL_CATEGORIES } from "../billing/pricing";

/** Nemotron + LoRA を Nebius のエンドポイントで動かす設定。載せるモデルと LoRA はモデルの列に持つ */
export const modelConfigSchema = z.object({
  /** 1回の返答の上限 (利用者が大きな max_tokens を送ってきてもここで抑える) */
  maxOutputTokens: z.number().int().min(16).max(32_000).default(2048),
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;

export function defaultModelConfig(): ModelConfig {
  return { maxOutputTokens: 2048 };
}

export function parseModelConfig(rawConfig: string): ModelConfig | null {
  try {
    const parsed = modelConfigSchema.safeParse(JSON.parse(rawConfig));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const modelMetadataSchema = z.object({
  name: z.string().trim().min(1).max(80),
  tagline: z.string().trim().max(160).default(""),
  description: z.string().max(50_000).default(""),
  category: z.enum(MODEL_CATEGORIES),
  tags: z.array(z.string().trim().min(1).max(32)).max(10).default([]),
});

const micros = z.number().int().min(0).max(1_000_000_000_000);

export const modelPricingSchema = z.object({
  priceInputMicros: micros,
  priceOutputMicros: micros,
  pricePerRequestMicros: micros,
});

export type ModelPricing = z.infer<typeof modelPricingSchema>;

export function parseTags(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

/** エンドポイントの状態。none は一度も載せていない。deploying は作り直しの途中 (同時のデプロイを1つに絞る) */
export const ENDPOINT_STATUSES = [
  "none",
  "deploying",
  "starting",
  "running",
  "stopping",
  "stopped",
  "failed",
] as const;
export type EndpointState = (typeof ENDPOINT_STATUSES)[number];
