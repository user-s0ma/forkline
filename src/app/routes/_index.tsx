import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/_index";
import { FlowDiagram } from "@/components/landing/FlowDiagram";
import { SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import { listStoreModels, type StoreListing } from "@/lib/api-client";
import { localeTag, localizeHref, useLocale } from "@/lib/i18n";
import {
  formatYen,
  PAYOUT_MIN_YEN,
  PLATFORM_FEE_BPS,
} from "@/lib/billing/pricing";
import { DEFAULT_ENDPOINT_IDLE_MINUTES, endpointIdleMinutes } from "@/lib/billing/compute";
import { gpuName } from "@/components/landing/gpu";
import { listModels } from "@/lib/nebius/models";
import { appContext } from "@/lib/util/app-context";

/** 自動停止までの分数は環境変数で変えられるので、サーバーで読んで文面に入れる */
export function loader({ context }: Route.LoaderArgs) {
  try {
    const { env } = context.get(appContext);
    return { idleMinutes: endpointIdleMinutes(env) };
  } catch {
    return { idleMinutes: DEFAULT_ENDPOINT_IDLE_MINUTES };
  }
}

const SHARE = 100 - PLATFORM_FEE_BPS / 100;
const FEE = PLATFORM_FEE_BPS / 100;

function SectionTitle({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <div>
      <h2 className="h-display text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">{title}</h2>
      {lead && <p className="mt-3 max-w-md text-base leading-7 text-ink-soft">{lead}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- 5つの手順 */

const STEP_KEYS = ["s1", "s2", "s3", "s4", "s5"] as const;
const ASSISTED = new Set<string>(["s1", "s3"]);

/** 手順を1本の線路と駅で表す。スマホは縦、広い画面は横に並べる */
function Steps({ idleMinutes }: { idleMinutes: number }) {
  const { t } = useTranslation();
  return (
    <ol className="grid gap-10 lg:grid-cols-5 lg:gap-6">
      {STEP_KEYS.map((key, index) => {
        const last = index === STEP_KEYS.length - 1;
        return (
          <li key={key} className="relative pl-16 lg:pt-16 lg:pl-0">
            {!last && (
              <span
                aria-hidden
                className="absolute top-12 -bottom-10 left-[22px] w-[3px] rounded-full bg-brand-ink/70 lg:top-[22px] lg:right-[-1.5rem] lg:bottom-auto lg:left-12 lg:h-[3px] lg:w-auto"
              />
            )}
            <span
              className={`num absolute top-0 left-0 flex h-12 w-12 items-center justify-center rounded-full text-base font-semibold ${
                last ? "bg-brand text-on-brand" : "bg-surface text-brand-ink ring-[3px] ring-brand-ink ring-inset"
              }`}
            >
              {index + 1}
            </span>
            <h3 className="pt-2.5 text-xl font-semibold tracking-[-0.01em] lg:pt-0">
              {t(`landing.steps.${key}.title`)}
            </h3>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              {t(`landing.steps.${key}.body`, { idle: idleMinutes, share: SHARE })}
            </p>
            {ASSISTED.has(key) && (
              <p className="mt-3 border-l-2 border-brand-ink pl-3 text-sm leading-6 text-ink">
                {t(`landing.steps.${key}.assist`)}
              </p>
            )}
            <p className="mt-3 text-xs font-medium text-ink-mute">{t(`landing.steps.${key}.where`)}</p>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------- 作る人にとって */

const WHY_KEYS = ["gpu", "idle", "api", "payout"] as const;

function Why({ idleMinutes }: { idleMinutes: number }) {
  const { t } = useTranslation();
  const tag = localeTag(useLocale());
  return (
    <div className="grid gap-12 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <SectionTitle title={t("landing.why.title")} lead={t("landing.why.lead")} />
        {/* 利用者が払う価格の内訳。数字は手数料の定数から出す */}
        <figure className="mt-10">
          <figcaption className="text-sm font-semibold">{t("landing.why.splitTitle")}</figcaption>
          <div className="mt-3 flex h-12 overflow-hidden rounded-full text-xl font-bold">
            <div className="flex items-center bg-earn-fill px-4 text-on-earn" style={{ width: `${SHARE}%` }}>
              <span className="num">{SHARE}%</span>
            </div>
            <div className="flex flex-1 items-center justify-center bg-line text-ink">
              <span className="num">{FEE}%</span>
            </div>
          </div>
          <div className="mt-2 flex justify-between gap-4 text-xs text-ink-soft">
            <span>{t("landing.why.splitCreator")}</span>
            <span className="text-right">{t("landing.why.splitFee")}</span>
          </div>
          <p className="mt-4 text-sm leading-6 text-ink-mute">{t("landing.why.splitNote")}</p>
        </figure>
      </div>
      <dl className="grid gap-x-10 sm:grid-cols-2 lg:col-span-7">
        {WHY_KEYS.map((key) => (
          <div key={key} className="border-t border-line py-6">
            <dt className="text-base font-semibold">{t(`landing.why.${key}.title`)}</dt>
            <dd className="mt-2 text-sm leading-6 text-ink-soft">
              {t(`landing.why.${key}.body`, {
                idle: idleMinutes,
                min: PAYOUT_MIN_YEN.toLocaleString(tag),
              })}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---------------------------------------------------------------- Nebius と NVIDIA */

const STACK_ROWS = ["train", "serve", "storage", "assist"] as const;

function Stack() {
  const { t } = useTranslation();
  const models = listModels();
  return (
    <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
      <div className="lg:col-span-4">
        <SectionTitle title={t("landing.stack.title")} lead={t("landing.stack.lead")} />
      </div>
      <div className="space-y-10 lg:col-span-8">
        <table className="w-full text-left text-sm">
          <thead className="sr-only sm:not-sr-only">
            <tr className="border-b border-line text-xs text-ink-mute">
              <th scope="col" className="py-2.5 pr-4 font-medium">{t("landing.stack.role")}</th>
              <th scope="col" className="py-2.5 pr-4 font-medium">{t("landing.stack.service")}</th>
              <th scope="col" className="py-2.5 font-medium">{t("landing.stack.detail")}</th>
            </tr>
          </thead>
          <tbody>
            {STACK_ROWS.map((key) => (
              <tr
                key={key}
                className="grid border-b border-line py-4 sm:table-row sm:py-0"
              >
                <th scope="row" className="font-semibold sm:py-4 sm:pr-4 sm:align-top">
                  {t(`landing.stack.rows.${key}.role`)}
                </th>
                <td className="text-brand-ink sm:py-4 sm:pr-4 sm:align-top sm:whitespace-nowrap">
                  {t(`landing.stack.rows.${key}.service`)}
                </td>
                <td className="mt-1 leading-6 text-ink-soft sm:mt-0 sm:py-4 sm:align-top">
                  {t(`landing.stack.rows.${key}.detail`)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div>
          <h3 className="text-base font-semibold">{t("landing.stack.modelsTitle")}</h3>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {models.map((model, index) => (
              <li key={model.id} className="rounded-2xl border border-line p-5">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{model.label}</span>
                  {index === 0 && (
                    <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-ink">
                      {t("landing.stack.default")}
                    </span>
                  )}
                </p>
                <p className="mt-1 font-mono text-xs break-all text-ink-mute">{model.id}</p>
                <dl className="mt-4 flex gap-6 text-sm">
                  <div>
                    <dt className="text-xs text-ink-mute">{t("landing.stack.trainGpu")}</dt>
                    <dd className="font-semibold">{gpuName(model.trainPreset)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-mute">{t("landing.stack.serveGpu")}</dt>
                    <dd className="font-semibold">{gpuName(model.servePreset)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 公開中のモデル */

/** 一覧に出す代表価格。1リクエストあたり > 出力 > 入力 の順で選ぶ */
function usePriceText() {
  const { t } = useTranslation();
  const tag = localeTag(useLocale());
  return ({ pricing }: StoreListing) => {
    if (pricing.priceOutputMicros > 0) {
      return { price: formatYen(pricing.priceOutputMicros, tag), unit: t("landing.models.perMillionOutput") };
    }
    if (pricing.pricePerRequestMicros > 0) {
      return { price: formatYen(pricing.pricePerRequestMicros, tag), unit: t("landing.models.perRequest") };
    }
    if (pricing.priceInputMicros > 0) {
      return { price: formatYen(pricing.priceInputMicros, tag), unit: t("landing.models.perMillionInput") };
    }
    return null;
  };
}

function ModelRow({ model }: { model: StoreListing }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const priceText = usePriceText()(model);
  return (
    <li>
      <a
        href={localizeHref(`/models/${encodeURIComponent(model.slug)}`, locale)}
        className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 px-5 py-5 transition-colors hover:bg-paper sm:grid-cols-[1.4fr_0.9fr_0.8fr]"
      >
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold">{model.name}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-mute">
            {model.publisherName}
          </span>
        </span>
        <span className="hidden truncate text-sm text-ink-soft sm:block">
          {model.baseModel ?? "Nemotron"}
        </span>
        <span className="num text-right text-sm">
          {priceText ? (
            <>
              <span className="font-semibold">{priceText.price}</span>
              <span className="text-ink-mute"> / {priceText.unit}</span>
            </>
          ) : (
            t("landing.models.free")
          )}
        </span>
      </a>
    </li>
  );
}

function LiveModels() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data, isPending, isError } = useQuery({
    queryKey: ["landing-models"],
    queryFn: () => listStoreModels({ sort: "popular" }),
  });
  const items = data?.items.slice(0, 6) ?? [];

  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <div className="hidden grid-cols-[1.4fr_0.9fr_0.8fr] gap-x-6 border-b border-line bg-paper px-5 py-3 text-xs text-ink-mute sm:grid">
        <span>{t("landing.models.columns.model")}</span>
        <span>{t("landing.models.columns.base")}</span>
        <span className="text-right">{t("landing.models.columns.price")}</span>
      </div>
      {isPending ? (
        <ul className="divide-y divide-line" aria-hidden>
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index} className="h-[4.75rem] animate-pulse px-5 py-5">
              <span className="block h-4 w-1/3 rounded bg-paper" />
              <span className="mt-2 block h-3 w-1/4 rounded bg-paper" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 || isError ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-ink-soft">{t("landing.models.empty")}</p>
          <a href="/app" className="mt-3 inline-flex text-sm font-semibold text-brand-ink hover:underline">
            {t("landing.models.emptyCta")}
          </a>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((model) => (
            <ModelRow key={model.slug} model={model} />
          ))}
        </ul>
      )}
      <a
        href={localizeHref("/models", locale)}
        className="block border-t border-line px-5 py-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-paper"
      >
        {t("landing.models.viewAll")}
      </a>
    </div>
  );
}

/* ---------------------------------------------------------------- API */

/** OpenAI の SDK と同じ呼び方の例 (料金はレスポンスのヘッダーで返る) */
function ApiExample() {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-code font-mono text-[13px] leading-6">
      <div className="border-b border-line px-5 py-2.5 text-xs text-ink-mute">
        {t("landing.api.requestLabel")}
      </div>
      <pre className="overflow-x-auto px-5 py-4 text-code-ink">
        <code>
          {"from openai import OpenAI\n\n"}
          {'client = OpenAI(base_url="https://forkline.ai/v1", api_key="fk_...")\n\n'}
          {"res = client.chat.completions.create(\n"}
          {"    model="}
          <span className="text-brand-ink">&quot;your-model&quot;</span>
          {",  "}
          <span className="text-ink-mute"># {t("landing.api.comment")}</span>
          {`\n    messages=[{"role": "user", "content": "${t("landing.api.prompt")}"}],\n)\n`}
          {"print(res.choices[0].message.content)"}
        </code>
      </pre>
      <div className="border-y border-line px-5 py-2.5 text-xs text-ink-mute">
        {t("landing.api.responseLabel")}
      </div>
      <pre className="overflow-x-auto px-5 py-4 text-code-ink">
        <code>
          {"HTTP/1.1 200 OK\nX-Forkline-Cost-JPY: …\n\n"}
          {'{"model": "your-model", "choices": [ … ], "usage": { … }}'}
        </code>
      </pre>
    </div>
  );
}

/* ---------------------------------------------------------------- よくある質問 */

const FAQ_KEYS = ["1", "2", "3", "4", "5", "6"] as const;

function Faq({ idleMinutes }: { idleMinutes: number }) {
  const { t } = useTranslation();
  const models = listModels();
  const vars = {
    idle: idleMinutes,
    models: models.map((model) => model.label).join(" / "),
    default: models[0]?.label ?? "",
  };
  return (
    <div className="divide-y divide-line border-y border-line">
      {FAQ_KEYS.map((key) => (
        <details key={key} className="group py-1">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
            {t(`landing.faq.q${key}`)}
            <span
              aria-hidden
              className="text-xl leading-none font-normal text-ink-mute transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="max-w-2xl pb-5 text-sm leading-7 text-ink-soft">
            {t(`landing.faq.a${key}`, vars)}
          </p>
        </details>
      ))}
    </div>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const idleMinutes = loaderData?.idleMinutes ?? DEFAULT_ENDPOINT_IDLE_MINUTES;

  return (
    <div className="site relative min-h-screen overflow-x-clip bg-surface font-sans text-ink antialiased">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[760px]"
      >
        <div className="hero-backdrop absolute inset-0" />
        <div className="hero-noise absolute inset-0 opacity-60" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-canvas" />
      </div>

      <div className="relative">
        <SiteHeader transparentAtTop />

        <section className="ui-container relative grid gap-14 pt-12 pb-16 sm:pt-16 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16 lg:py-24">
          <div className="max-w-[38rem]">
            <p className="text-sm font-semibold text-brand-ink">{t("landing.hero.eyebrow")}</p>
            <h1 className="h-display mt-4 text-[clamp(2.1rem,4.4vw,3.6rem)] font-semibold tracking-[-0.035em]">
              <span className="block">{t("landing.hero.title1")}</span>
              <span className="block">{t("landing.hero.title2")}</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-ink-soft sm:text-lg">
              {t("landing.hero.subtitle")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/app" className="ui-button-primary">
                {t("landing.hero.ctaPrimary")}
              </a>
              <a href={localizeHref("/models", locale)} className="ui-button-secondary">
                {t("landing.hero.ctaSecondary")}
              </a>
            </div>
            <a
              href={localizeHref("/docs", locale)}
              className="mt-5 inline-flex text-sm font-semibold text-brand-ink hover:underline"
            >
              {t("landing.hero.ctaTertiary")}
            </a>
          </div>
          <FlowDiagram />
        </section>

        {/* データから売上まで */}
        <section className="border-t border-line">
          <div className="ui-container py-16 lg:py-24">
            <SectionTitle title={t("landing.steps.title")} lead={t("landing.steps.lead")} />
            <div className="mt-12">
              <Steps idleMinutes={idleMinutes} />
            </div>
          </div>
        </section>

        {/* 作る人にとって */}
        <section className="border-t border-line bg-paper/60">
          <div className="ui-container py-16 lg:py-24">
            <Why idleMinutes={idleMinutes} />
          </div>
        </section>

        {/* Nebius と NVIDIA */}
        <section className="border-t border-line">
          <div className="ui-container py-16 lg:py-24">
            <Stack />
          </div>
        </section>

        {/* API */}
        <section className="border-t border-line">
          <div className="ui-container grid grid-cols-1 gap-10 py-16 lg:grid-cols-12 lg:gap-12 lg:py-24">
            <div className="lg:col-span-4">
              <SectionTitle title={t("landing.api.title")} lead={t("landing.api.lead")} />
              <p className="mt-6 max-w-md text-sm leading-6 text-ink-mute">{t("landing.api.warm")}</p>
              <a
                href={localizeHref("/docs", locale)}
                className="mt-6 inline-flex text-sm font-semibold text-brand-ink hover:underline"
              >
                {t("landing.api.docs")}
              </a>
            </div>
            <div className="min-w-0 lg:col-span-8">
              <ApiExample />
            </div>
          </div>
        </section>

        {/* 公開中のモデル */}
        <section className="border-t border-line">
          <div className="ui-container grid grid-cols-1 gap-10 py-16 lg:grid-cols-12 lg:gap-12 lg:py-24">
            <div className="lg:col-span-4">
              <SectionTitle title={t("landing.models.title")} lead={t("landing.models.lead")} />
            </div>
            <div className="lg:col-span-8">
              <LiveModels />
            </div>
          </div>
        </section>

        {/* よくある質問 */}
        <section className="border-t border-line">
          <div className="ui-container grid grid-cols-1 gap-10 py-16 lg:grid-cols-12 lg:gap-12 lg:py-24">
            <div className="lg:col-span-4">
              <SectionTitle title={t("landing.faq.title")} />
            </div>
            <div className="lg:col-span-8">
              <Faq idleMinutes={idleMinutes} />
            </div>
          </div>
        </section>

        <section className="bg-brand text-on-brand">
          <div className="ui-container flex flex-col items-start justify-between gap-8 py-16 sm:py-20 lg:flex-row lg:items-end">
            <div>
              <p className="text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.1] font-semibold tracking-[-0.035em]">
                {t("landing.finalCta.title")}
              </p>
              <p className="mt-5 inline-flex rounded-full bg-on-brand/10 px-4 py-2 font-mono text-base font-medium">
                https://forkline.ai/v1
              </p>
            </div>
            <a
              href="/app"
              className="inline-flex items-center justify-center rounded-full bg-on-brand px-7 py-3.5 text-base font-semibold text-brand transition-colors hover:bg-on-brand/85 focus-visible:outline-on-brand"
            >
              {t("landing.finalCta.cta")}
            </a>
          </div>
        </section>

        <SiteFooter />
      </div>
    </div>
  );
}
