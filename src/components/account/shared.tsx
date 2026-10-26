import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { DailyAmount } from "@/lib/api-client";
import { LOCALE_TAG } from "@/lib/i18n";

/** 数字を1枚のパネルに並べる帯。セルは1pxの線で区切る */
export function StatStrip({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 }) {
  return (
    <section
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-(--radius-panel) border border-line bg-line ${
        // 3つのときは2列で余ったマスが空くので、最後の1つを横いっぱいに広げる
        cols === 3 ? "lg:grid-cols-3 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1" : "lg:grid-cols-4"
      }`}
    >
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  to,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  to?: string;
  /** brand はクレジット残高、earn は入ってくるお金 (収益) */
  tone?: "ink" | "brand" | "earn";
}) {
  const body = (
    <>
      <p className="text-xs text-ink-mute">{label}</p>
      <p
        className={`num mt-1.5 truncate text-2xl font-semibold tracking-[-0.01em] ${
          tone === "earn" ? "text-earn" : tone === "brand" ? "text-brand-ink" : "text-ink"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 truncate text-xs text-ink-mute">{hint}</p>}
    </>
  );
  const className = "block min-w-0 bg-paper px-4 py-4 sm:px-5";
  return to ? (
    <Link className={`${className} transition-colors hover:bg-paper`} to={to}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** パネル見出し。右側に「すべて見る」などのリンクを置ける */
export function PanelHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && (
          <p className="mt-0.5 text-xs leading-5 text-ink-mute">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0 text-sm">{action}</div>}
    </div>
  );
}

export function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="text-sm text-brand-ink hover:underline" to={to}>
      {children}
    </Link>
  );
}

function localDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 直近30日を日ごとに埋めた棒グラフ (データの無い日は0)。 */
export function DailyBars({
  days,
  label,
  formatValue,
  tone = "brand",
}: {
  days: DailyAmount[];
  label: string;
  formatValue: (micros: number) => string;
  /** brand=支出、earn=収益 */
  tone?: "brand" | "earn";
}) {
  const series = useMemo(() => {
    const byDay = new Map(days.map((day) => [day.day, day]));
    const result: Array<{ day: string; micros: number; requests: number }> = [];
    const today = new Date();
    for (let offset = 29; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      const key = localDayKey(date);
      const entry = byDay.get(key);
      result.push({
        day: key,
        micros: entry?.micros ?? 0,
        requests: entry?.requests ?? 0,
      });
    }
    return result;
  }, [days]);
  const peak = Math.max(0, ...series.map((entry) => entry.micros));
  const max = Math.max(1, peak);
  const dayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(LOCALE_TAG, {
        month: "numeric",
        day: "numeric",
      }),
    [],
  );
  const format = (day: string) => dayFormatter.format(new Date(`${day}T00:00:00`));
  const barColor =
    tone === "earn" ? "bg-earn/80 group-hover:bg-earn" : "bg-brand-ink/80 group-hover:bg-brand-ink";

  return (
    <figure aria-label={label}>
      <div className="flex gap-3">
        <div className="relative h-40 flex-1 border-b border-line">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line"
            aria-hidden
          />
          <div className="flex h-full items-end gap-[3px]">
            {series.map((entry) => (
              <div
                key={entry.day}
                className="group flex h-full flex-1 items-end justify-center"
                title={`${format(entry.day)}: ${formatValue(entry.micros)} / ${entry.requests}`}
              >
                <div
                  className={`w-full max-w-3 rounded-t-sm transition-colors ${barColor}`}
                  style={{
                    height: `${entry.micros > 0 ? Math.max(3, (entry.micros / max) * 100) : 0}%`,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="num flex h-40 w-14 shrink-0 flex-col justify-between text-right text-[11px] text-ink-mute">
          <span className="-translate-y-1.5">{formatValue(peak)}</span>
          <span className="translate-y-1.5">{formatValue(0)}</span>
        </div>
      </div>
      <div className="num mt-2 flex justify-between pr-17 text-[11px] text-ink-mute">
        <span>{format(series[0].day)}</span>
        <span>{format(series[14].day)}</span>
        <span>{format(series[series.length - 1].day)}</span>
      </div>
    </figure>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="console-button-secondary shrink-0"
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          },
          () => toast.error(t("apiKeys.copyFailed")),
        );
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? t("common.copied") : (label ?? t("common.copy"))}
    </button>
  );
}

