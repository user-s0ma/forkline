/** Nebius のプリセット ("gpu-l40s-a/1gpu-16vcpu-64gb") から、画面に出す GPU の名前を取り出す */
const GPU_NAMES: Record<string, string> = {
  "gpu-l40s-a": "NVIDIA L40S",
  "gpu-h100-sxm": "NVIDIA H100",
  "gpu-h200-sxm": "NVIDIA H200",
};

export function gpuName(preset: string) {
  const [platform, size] = preset.split("/");
  const count = Number.parseInt(size ?? "", 10);
  const name = GPU_NAMES[platform] ?? platform;
  return Number.isFinite(count) && count > 1 ? `${count}× ${name}` : name;
}
