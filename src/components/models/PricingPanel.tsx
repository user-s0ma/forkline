import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelUpdateInput } from "@/lib/api-client";
import { localeTag, useLocale } from "@/lib/i18n";
import {
  formatYen,
  microsToYen,
  PLATFORM_FEE_BPS,
  quoteUsage,
  yenToMicros,
} from "@/lib/billing/pricing";
import { Field, NumberInput, Section } from "./ui";

type Pricing = ModelUpdateInput["pricing"];

/** 1回あたりの想定の入出力トークン */
const EXAMPLE = { inputTokens: 1000, outputTokens: 500 };
const TOKENS_PER_CALL = EXAMPLE.inputTokens + EXAMPLE.outputTokens;
/** 売上の目安の量 (トークン数)。トークン数から呼び出し回数を割り出して計算する */
const TOKEN_VOLUMES = [1_000_000, 10_000_000, 100_000_000] as const;

export function PricingPanel({
  id,
  endpointMicrosPerHour = null,
  pricing,
  onChange,
}: {
  id?: string;
  /** Nebius で動かすときの GPU の1時間あたりの料金 (公開した組織が払う) */
  endpointMicrosPerHour?: number | null;
  pricing: Pricing;
  onChange: (pricing: Pricing) => void;
}) {
  const { t } = useTranslation();
  const tag = localeTag(useLocale());
  const volumes: readonly number[] = TOKEN_VOLUMES;
  const [volumeIndex, setVolumeIndex] = useState(1);
  const volume = volumes[volumeIndex];
  const calls = volume / TOKENS_PER_CALL;
  const set = (key: keyof Pricing, yen: number | null) =>
    onChange({ ...pricing, [key]: yenToMicros(Math.max(0, yen ?? 0)) });

  const quote = quoteUsage(pricing, {
    inputTokens: EXAMPLE.inputTokens,
    outputTokens: EXAMPLE.outputTokens,
    computeMicros: 0,
  });
  const gross = quote.creatorMicros + quote.platformFeeMicros;
  const yen = (micros: number) => formatYen(micros, tag);
  const total = (micros: number) => yen(Math.round(micros * calls));
  const compact = new Intl.NumberFormat(tag, { notation: "compact" });

  const fields: Array<[keyof Pricing, string]> = [
    ["priceInputMicros", "models.pricing.input"],
    ["priceOutputMicros", "models.pricing.output"],
    ["pricePerRequestMicros", "models.pricing.perRequest"],
  ];

  return (
    <div id={id} className="scroll-mt-6">
      <Section
        title={t("models.pricing.title")}
      >
        <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map(([key, label]) => (
                  <Field key={key} label={t(label)} hint={t(`${label}Hint`)}>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-mute">
                        ¥
                      </span>
                      <NumberInput
                        value={microsToYen(pricing[key])}
                        min={0}
                        step="any"
                        className="pl-7"
                        onChange={(value) => set(key, value)}
                      />
                    </div>
                  </Field>
                ))}
            </div>
            {endpointMicrosPerHour !== null && (
              <p className="text-sm leading-6 text-ink-mute">
                {t("models.pricing.computeNote", { perHour: yen(endpointMicrosPerHour) })}
              </p>
            )}
          </div>

          {/* トークン数 (チャット以外は呼び出し回数) を選んで、売上の目安をレシート風に見せる */}
          <figure className="rounded-(--radius-control) border border-line bg-surface px-4 py-3">
            <figcaption className="text-sm font-semibold">
              {t("models.pricing.simulationTitleTokens")}
            </figcaption>
            <div
              className="ui-tabs mt-2 min-h-0"
              role="group"
              aria-label={t("models.pricing.tokensLabel")}
            >
              {volumes.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  className="ui-tab num px-1 py-1 text-xs whitespace-nowrap"
                  aria-pressed={volumeIndex === index}
                  onClick={() => setVolumeIndex(index)}
                >
                  {t("models.pricing.tokensOption", { tokens: compact.format(option) })}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-5 text-ink-mute">
              {t("models.pricing.exampleVolume", {
                input: EXAMPLE.inputTokens.toLocaleString(tag),
                output: EXAMPLE.outputTokens.toLocaleString(tag),
              })}
            </p>
            <dl className="num mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">{t("models.pricing.creatorGross")}</dt>
                <dd>{total(gross)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-line-strong pt-1.5 font-semibold">
                <dt>{t("models.pricing.consumerTotal")}</dt>
                <dd>{total(quote.totalMicros)}</dd>
              </div>
              <div className="flex justify-between gap-3 pt-3 text-ink-mute">
                <dt>{t("models.pricing.platformFee", { fee: PLATFORM_FEE_BPS / 100 })}</dt>
                <dd>−{total(quote.platformFeeMicros)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 font-semibold text-earn">
                <dt>{t("models.pricing.creatorNet")}</dt>
                <dd className="text-lg">{total(quote.creatorMicros)}</dd>
              </div>
            </dl>
            <p className="num mt-2 text-xs text-ink-mute">
              {t("models.pricing.perMillionTokens", {
                total: yen(Math.round((quote.totalMicros * 1_000_000) / TOKENS_PER_CALL)),
                net: yen(Math.round((quote.creatorMicros * 1_000_000) / TOKENS_PER_CALL)),
              })}
            </p>
          </figure>
        </div>
      </Section>
    </div>
  );
}
