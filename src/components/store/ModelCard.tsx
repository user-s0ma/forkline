import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge } from "@/components/ui/Badge";
import type { StoreListing } from "@/lib/api-client";
import { CATEGORY_ICONS } from "./category-icons";
import { headlinePrice } from "./price";
import { usePriceLabel } from "./price-label";

export function CategoryBadge({
  category,
}: {
  category: StoreListing["category"];
}) {
  const { t } = useTranslation();
  const Icon = CATEGORY_ICONS[category] ?? CATEGORY_ICONS.other;
  return (
    <Badge>
      <Icon className="h-3 w-3" aria-hidden />
      {t(`store.categories.${category}`)}
    </Badge>
  );
}

/**
 * ストアのモデルカード。一覧で見比べる項目 (名前・公開者・説明・ベースモデル・代表価格) を同じ位置に置く。
 * 代表価格は出力トークン単価 > リクエスト単価 > 入力トークン単価 の順 (headlinePrice)。
 */
export function ModelCard({
  model,
  href,
}: {
  model: StoreListing;
  href: string;
}) {
  const { t } = useTranslation();
  const describe = usePriceLabel();
  const headline = headlinePrice(model.pricing);
  const price = headline ? describe(headline) : null;
  const base = model.baseModel ?? "Nemotron";

  return (
    <Link
      to={href}
      className="group flex h-full flex-col rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-paper/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base leading-6 font-semibold text-ink group-hover:text-brand-ink">
            {model.name}
          </h3>
          {model.publisherName && (
            <p className="truncate text-sm text-ink-mute">
              {t("store.detail.by", { publisher: model.publisherName })}
            </p>
          )}
        </div>
        <CategoryBadge category={model.category} />
      </div>
      <p className="mt-3 mb-5 line-clamp-2 min-h-12 text-sm leading-6 text-ink-soft">
        {model.tagline}
      </p>
      <dl className="mt-auto grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 border-t border-line pt-4">
        <div className="min-w-0">
          <dt className="text-xs text-ink-mute">{t("landing.models.columns.base")}</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-ink">
            <Cpu className="h-3.5 w-3.5 shrink-0 text-ink-mute" aria-hidden />
            <span className="truncate">{base}</span>
          </dd>
        </div>
        <div className="text-right">
          <dt className="text-xs text-ink-mute">
            {price
              ? `${price.label ? `${price.label} ` : ""}${price.unit}`
              : t("landing.models.columns.price")}
          </dt>
          <dd className="num mt-0.5 text-lg leading-6 font-semibold text-ink">
            {price ? price.price : t("store.card.free")}
          </dd>
        </div>
      </dl>
    </Link>
  );
}

export function ModelCardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5" aria-hidden>
      <div className="h-4 w-2/5 animate-pulse rounded bg-line" />
      <div className="mt-2 h-3 w-1/4 animate-pulse rounded bg-line" />
      <div className="mt-5 h-3 w-full animate-pulse rounded bg-line" />
      <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-line" />
      <div className="mt-6 flex justify-between border-t border-line pt-4">
        <div className="h-8 w-1/3 animate-pulse rounded bg-line" />
        <div className="h-8 w-1/5 animate-pulse rounded bg-line" />
      </div>
    </div>
  );
}
