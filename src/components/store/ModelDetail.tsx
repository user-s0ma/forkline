import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Check, Copy, Cpu, FlaskConical, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CATEGORY_ICONS } from "@/components/store/category-icons";
import { CodeBlock } from "@/components/store/CodeBlock";
import { useCopy } from "@/components/store/use-copy";
import { apiSnippets } from "@/components/store/snippets";
import { PriceTable, RecentCost } from "@/components/store/PriceTable";
import {
  ApiError,
  getStoreModel,
  type PublicEvaluation,
  type StoreModelDetail,
} from "@/lib/api-client";
import { localeTag, useLocale } from "@/lib/i18n";

/*
 * モデル詳細の中身 (/models/:slug)。
 */

export const DETAIL_LAYOUT = "grid gap-10 lg:grid-cols-[minmax(0,1fr)_25rem]";

export function useStoreModel(slug: string) {
  const query = useQuery({
    queryKey: ["store-model", slug],
    queryFn: () => getStoreModel(slug),
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 404) && count < 1,
  });
  return {
    ...query,
    notFound: query.error instanceof ApiError && query.error.status === 404,
  };
}

function StatChip({
  icon: Icon,
  children,
}: {
  icon?: typeof Cpu;
  children: ReactNode;
}) {
  return (
    <span className="glass inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-sm text-ink-soft">
      {Icon ? (
        <Icon className="h-3.5 w-3.5 text-brand-ink" aria-hidden />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-brand-ink" aria-hidden />
      )}
      {children}
    </span>
  );
}

/** カテゴリ・ベースモデル・リクエスト数・公開日・公開者 */
export function ModelStats({ model }: { model: StoreModelDetail }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(localeTag(locale)),
    [locale],
  );
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(localeTag(locale), { dateStyle: "medium" }),
    [locale],
  );
  return (
    <div className="flex flex-wrap gap-2">
      <StatChip
       
        icon={CATEGORY_ICONS[model.category] ?? CATEGORY_ICONS.other}
      >
        {t(`store.categories.${model.category}`)}
      </StatChip>
      {model.baseModel && (
        <StatChip>{t("store.detail.baseModel", { model: model.baseModel })}</StatChip>
      )}
      <StatChip>
        <span className="num">
          {t("store.detail.requests", {
            n: numberFormatter.format(model.totalRequests),
          })}
        </span>
      </StatChip>
      {model.publishedAt && (
        <StatChip>
          {t("store.detail.publishedAt", {
            date: dateFormatter.format(new Date(model.publishedAt)),
          })}
        </StatChip>
      )}
      <StatChip>
        {t("store.detail.by", { publisher: model.publisherName })}
      </StatChip>
    </div>
  );
}

function ModelIdPanel({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopy();
  return (
    <div className="border-t border-line px-5 py-4">
      <p className="text-xs text-ink-mute">{t("store.detail.modelId")}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-sm text-brand-ink">
          {slug}
        </code>
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-mute hover:bg-line hover:text-ink"
          aria-label={t("store.detail.copyId")}
          onClick={() => void copy(slug)}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

/**
 * 「Nemotron による評価」。取っておいた評価用の質問で、ベースの Nemotron と比べた点数。
 * 問題数が少ないときや差がはっきりしないときは、そう書く (数字だけを大きく見せない)。
 */
function EvaluationSection({ evaluation }: { evaluation: PublicEvaluation }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(localeTag(locale), { dateStyle: "medium" }),
    [locale],
  );
  const stats = [
    {
      label: t("store.evaluation.fineTuned"),
      value: `${evaluation.fineTunedMean.toFixed(2)}`,
      strong: true,
    },
    { label: t("store.evaluation.base"), value: `${evaluation.baseMean.toFixed(2)}`, strong: false },
  ];
  return (
    <section>
      <h2 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.01em]">
        <FlaskConical className="h-5 w-5 text-brand-ink" aria-hidden />
        {t("store.evaluation.title")}
      </h2>
      <div className="glass glow-card mt-4 rounded-3xl p-5">
        <dl className="grid grid-cols-2 gap-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-xs text-ink-mute">{stat.label}</dt>
              <dd
                className={`num mt-1 text-2xl font-semibold ${stat.strong ? "text-brand-ink" : "text-ink"}`}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm leading-6 text-ink-soft">
          {t(`store.evaluation.verdicts.${evaluation.verdict}`, {
            n: evaluation.n,
            p: evaluation.signTestP,
          })}
        </p>
        <p className="num mt-2 text-xs leading-5 text-ink-mute">
          {t("store.evaluation.method", {
            n: evaluation.n,
            wins: evaluation.wins,
            ties: evaluation.ties,
            losses: evaluation.losses,
            baseline: evaluation.baselineModel,
            judge: evaluation.judgeModel,
          })}
          {evaluation.completedAt &&
            ` ${t("store.evaluation.date", {
              date: dateFormatter.format(new Date(evaluation.completedAt)),
            })}`}
        </p>
      </div>
    </section>
  );
}

/** 説明・API の呼び出し例・料金・プレイグラウンド */
export function ModelDetailBody({
  model,
  tagHref,
  playground,
}: {
  model: StoreModelDetail;
  tagHref: (tag: string) => string;
  playground: ReactNode;
}) {
  const { t } = useTranslation();
  const [snippet, setSnippet] = useState<"curl" | "python">("curl");
  const snippets = apiSnippets(model.slug);
  const card = "glass glow-card rounded-3xl";

  return (
    <div className={DETAIL_LAYOUT}>
      <div className="min-w-0 space-y-12">
        <section>
          <h2 className="text-xl font-semibold tracking-[-0.01em]">
            {t("store.detail.about")}
          </h2>
          <p className="mt-4 max-w-[72ch] text-[15px] leading-8 break-words whitespace-pre-wrap text-ink-soft">
            {model.description.trim() || (
              <span className="text-ink-mute">
                {t("store.detail.noDescription")}
              </span>
            )}
          </p>
          {model.tags.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {model.tags.map((tag) => (
                <Link
                  key={tag}
                  to={tagHref(tag)}
                  className="rounded-full border border-line px-3 py-1 text-xs text-ink-soft hover:border-brand-ink hover:text-ink"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          )}
        </section>

        {model.evaluation && <EvaluationSection evaluation={model.evaluation} />}

        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-[-0.01em]">
              {t("store.api.title")}
            </h2>
            <Link
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-ink hover:text-ink"
              to="/app"
            >
              <KeyRound className="h-4 w-4" />
              {t("store.api.createKey")}
            </Link>
          </div>
          <div
            className="mt-4 inline-flex rounded-full border border-line bg-paper p-1"
            role="tablist"
          >
            {(["curl", "python"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={snippet === value}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                  snippet === value
                    ? "bg-brand font-semibold text-on-brand"
                    : "text-ink-soft hover:text-ink"
                }`}
                onClick={() => setSnippet(value)}
              >
                {value === "curl" ? "cURL" : "Python"}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <CodeBlock
              label={snippet === "curl" ? "cURL" : "Python"}
              code={snippets[snippet]}
              highlight={model.slug}
              hideLabel
            />
          </div>
        </section>
      </div>

      <aside
        className="space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto"
      >
        <div className={card}>
          <div className="px-5 pt-5 pb-4">
            <h2 className="mb-3 text-sm font-semibold">
              {t("store.pricing.title")}
            </h2>
            <PriceTable pricing={model.pricing} />
            {!model.warm && (
              <p className="mt-3 text-xs leading-5 text-ink-mute">
                {t("store.detail.coldStart")}
              </p>
            )}
            {model.averageCostMicros !== null && (
              <dl>
                <RecentCost averageMicros={model.averageCostMicros} />
              </dl>
            )}
          </div>
          <ModelIdPanel slug={model.slug} />
        </div>
        <section className={`${card} p-5`}>
          <h2 className="mb-3 text-sm font-semibold">
            {t("store.playground.title")}
          </h2>
          {playground}
        </section>
      </aside>
    </div>
  );
}
