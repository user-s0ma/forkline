import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getModelStats } from "@/lib/api-client";
import { localeTag, useLocale } from "@/lib/i18n";
import { formatYen } from "@/lib/billing/pricing";
import { Section } from "./ui";

export function StatsPanel({
  organizationId,
  modelId,
}: {
  organizationId: string;
  modelId: string;
}) {
  const { t } = useTranslation();
  const tag = localeTag(useLocale());
  const { data, isPending, error } = useQuery({
    queryKey: ["model-stats", organizationId, modelId],
    queryFn: () => getModelStats(organizationId, modelId),
  });
  // 横軸の基準日は表示した時点で固定する
  const [today] = useState(() => Date.now());
  const recorded = data?.days ?? [];
  // 利用が無い日も 0 として並べ、常に直近30日の横軸にする (日付はDBと同じUTC)
  const byDay = new Map(recorded.map((day) => [day.day, day]));
  const days = Array.from({ length: 30 }, (_, index) => {
    const key = new Date(today - (29 - index) * 86_400_000).toISOString().slice(0, 10);
    return (
      byDay.get(key) ?? {
        day: key,
        requests: 0,
        failures: 0,
        creatorMicros: 0,
        inputTokens: 0,
        outputTokens: 0,
        avgLatencyMs: 0,
      }
    );
  });
  const totals = days.reduce(
    (sum, day) => ({
      requests: sum.requests + day.requests,
      failures: sum.failures + day.failures,
      creatorMicros: sum.creatorMicros + day.creatorMicros,
      latencyWeighted: sum.latencyWeighted + day.avgLatencyMs * day.requests,
    }),
    { requests: 0, failures: 0, creatorMicros: 0, latencyWeighted: 0 },
  );
  const maxRequests = Math.max(1, ...days.map((day) => day.requests));
  const avgLatency = totals.requests ? Math.round(totals.latencyWeighted / totals.requests) : 0;

  const stats = [
    ["requests", totals.requests.toLocaleString(tag), "text-ink"],
    ["failures", totals.failures.toLocaleString(tag), totals.failures ? "text-danger" : "text-ink"],
    ["revenue", formatYen(totals.creatorMicros, tag), "text-earn"],
    ["latency", t("models.stats.ms", { value: avgLatency.toLocaleString(tag) }), "text-ink"],
  ] as const;

  return (
    <Section title={t("models.stats.title")}>
      <dl className="grid grid-cols-2 gap-y-4 sm:grid-cols-4 sm:divide-x sm:divide-line">
        {stats.map(([key, value, color]) => (
          <div key={key} className="sm:px-5 sm:first:pl-0">
            <dt className="text-xs text-ink-mute">{t(`models.stats.${key}`)}</dt>
            <dd className={`num mt-1 text-xl font-semibold ${color}`}>
              {isPending ? "—" : value}
            </dd>
          </div>
        ))}
      </dl>
      {error ? (
        <p className="text-sm text-danger">{t("models.stats.loadFailed")}</p>
      ) : recorded.length === 0 ? (
        !isPending && (
          <p className="rounded-(--radius-control) bg-surface px-4 py-6 text-center text-sm text-ink-mute">
            {t("models.stats.empty")}
          </p>
        )
      ) : (
        <figure>
          <figcaption className="mb-2 text-xs text-ink-mute">
            {t("models.stats.chartTitle")}
          </figcaption>
          <div
            className="flex h-36 items-end gap-1 rounded-(--radius-control) bg-surface px-2 pt-3"
            role="img"
            aria-label={t("models.stats.chartTitle")}
          >
            {days.map((day) => (
              <div
                key={day.day}
                className="flex h-full flex-1 flex-col justify-end"
                title={t("models.stats.barTitle", {
                  day: day.day,
                  requests: day.requests,
                  revenue: formatYen(day.creatorMicros, tag),
                })}
              >
                {day.requests > 0 && (
                  <div
                    className="w-full rounded-t-sm bg-brand-ink"
                    style={{ height: `${Math.max(4, (day.requests / maxRequests) * 100)}%` }}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="num mt-1.5 flex justify-between text-xs text-ink-mute">
            <span>{days[0]?.day}</span>
            <span>{days.at(-1)?.day}</span>
          </div>
        </figure>
      )}
    </Section>
  );
}
