import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

/** 前後2ページずつの窓。最終ページへのジャンプや省略記号は出さない */
function pageWindow(current: number, totalPages: number) {
  const start = Math.max(1, current - 2);
  const end = Math.min(totalPages, current + 2);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

const PILL =
  "inline-flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-sm transition-colors";

/** page は 1 始まり */
export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;
  const ghost = `${PILL} border border-line text-ink-soft hover:border-line-strong hover:text-ink disabled:pointer-events-none disabled:opacity-40`;

  return (
    <nav
      aria-label={t("store.explore.pageAria")}
      className="mt-10 flex flex-wrap items-center justify-center gap-2"
    >
      <button
        type="button"
        className={`${ghost} gap-1 pl-2.5`}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {t("store.explore.prev")}
      </button>
      {pageWindow(page, totalPages).map((number) =>
        number === page ? (
          <span
            key={number}
            aria-current="page"
            className={`${PILL} num bg-brand font-semibold text-on-brand`}
          >
            {number}
          </span>
        ) : (
          <button
            key={number}
            type="button"
            className={`${ghost} num`}
            onClick={() => onChange(number)}
          >
            {number}
          </button>
        ),
      )}
      <button
        type="button"
        className={`${ghost} gap-1 pr-2.5`}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        {t("store.explore.next")}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </nav>
  );
}
