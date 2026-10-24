/**
 * 微調整できる Nemotron と、学習・推論に使う GPU の組み合わせ。
 * GPU とプリセット: https://docs.nebius.com/compute/virtual-machines/types.md
 * 料金 (2026-10-08 から): https://docs.nebius.com/compute/resources/pricing.md
 */
import type { NemotronBaseModel } from "./types";

/** 公開しない、ジョブとエンドポイントを組むための設定 */
export type NemotronRuntime = Omit<NemotronBaseModel, "maxContextTokens"> & {
  /** LoRA を掛ける層 (PEFT の target_modules) */
  loraTargetModules: string[];
  /** 学習時の 1 件の長さの上限 (トークン) */
  trainMaxSeqLen: number;
  /** 推論時の文脈長の上限 */
  serveMaxModelLen: number;
  /** vLLM の mamba 状態の型 (モデルカードの推奨) */
  mambaSsmCacheDtype: "float32" | "float16";
  trainDiskGib: number;
  serveDiskGib: number;
  /** ジョブの打ち切り時間 (秒) */
  trainTimeoutSeconds: number;
};

const MODELS: NemotronRuntime[] = [
  {
    // Mamba2 と Transformer の混成、4B。L40S 1 枚で bf16 の LoRA 学習と推論ができる
    id: "nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16",
    label: "Nemotron 3 Nano 4B",
    trainPreset: "gpu-l40s-a/1gpu-16vcpu-64gb",
    servePreset: "gpu-l40s-a/1gpu-8vcpu-32gb",
    // L40S $1.35/GPU 時 + vCPU $0.012/時 + RAM $0.0032/GiB 時
    trainUsdPerHour: 1.75,
    serveUsdPerHour: 1.55,
    // 要確認: vLLM の NemotronH で LoRA が効く層。注意 (q/k/v/o) と MLP (up/down) にとどめる
    loraTargetModules: ["q_proj", "k_proj", "v_proj", "o_proj", "up_proj", "down_proj"],
    trainMaxSeqLen: 2048,
    serveMaxModelLen: 16384,
    mambaSsmCacheDtype: "float32",
    trainDiskGib: 200,
    serveDiskGib: 200,
    trainTimeoutSeconds: 6 * 3600,
  },
  {
    // MoE 30B (有効 3B)。bf16 の重みが約 60GB なので学習は H200、推論は H100 1 枚 (モデルカードの推奨)
    id: "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16",
    label: "Nemotron 3.5 Lightning 30B-A3B",
    trainPreset: "gpu-h200-sxm/1gpu-16vcpu-200gb",
    servePreset: "gpu-h100-sxm/1gpu-16vcpu-200gb",
    trainUsdPerHour: 5.4,
    serveUsdPerHour: 4.5,
    // 要確認: エキスパート層への LoRA は vLLM で読めない恐れがあるので注意層だけに掛ける
    loraTargetModules: ["q_proj", "k_proj", "v_proj", "o_proj"],
    trainMaxSeqLen: 2048,
    serveMaxModelLen: 32768,
    mambaSsmCacheDtype: "float16",
    trainDiskGib: 300,
    serveDiskGib: 300,
    trainTimeoutSeconds: 6 * 3600,
  },
];

export function listModels(): NemotronBaseModel[] {
  return MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    trainPreset: m.trainPreset,
    servePreset: m.servePreset,
    trainUsdPerHour: m.trainUsdPerHour,
    serveUsdPerHour: m.serveUsdPerHour,
    maxContextTokens: m.serveMaxModelLen,
  }));
}

/** "プラットフォーム/プリセット" を Nebius の spec の 2 項目に分ける */
export function splitPreset(value: string): { platform: string; preset: string } {
  const [platform, preset] = value.split("/");
  return { platform, preset };
}

export function findModel(id: unknown): NemotronRuntime | undefined {
  return MODELS.find((m) => m.id === id);
}
