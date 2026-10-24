import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "brand" | "earn" | "signal" | "danger";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface text-ink-soft ring-line",
  brand: "bg-brand-tint text-brand-ink ring-brand-ink/25",
  earn: "bg-earn-tint text-earn ring-earn/25",
  signal: "bg-signal-tint text-signal ring-signal/30",
  danger: "bg-danger-tint text-danger ring-danger/30",
};

/**
 * 状態を表す小さなラベル。色は意味で選ぶ:
 * brand=公開中などの主状態 / earn=収益 / signal=処理中・要対応 / danger=失敗
 */
export function Badge({
  tone = "neutral",
  dot = false,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${TONES[tone]}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
