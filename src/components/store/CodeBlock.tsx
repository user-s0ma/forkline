import type { ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCopy } from "./use-copy";

/** code 中の highlight (モデルID) をブランドカラーで目立たせる */
function renderCode(code: string, highlight?: string): ReactNode {
  if (!highlight) return code;
  const parts = code.split(highlight);
  return parts.flatMap((part, index) =>
    index === 0
      ? [part]
      : [
          <span key={index} className="text-brand-ink">
            {highlight}
          </span>,
          part,
        ],
  );
}

export function CodeBlock({
  label,
  code,
  highlight,
}: {
  label: string;
  code: string;
  highlight?: string;
}) {
  const { t } = useTranslation();
  const { copied, copy } = useCopy();

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-code">
      <div className="flex items-center justify-between border-b border-line py-1.5 pr-1.5 pl-4">
        <span className="font-mono text-xs text-ink-mute">{label}</span>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-full px-3 text-xs text-ink-soft hover:bg-line hover:text-ink"
          onClick={() => void copy(code)}
          aria-label={`${t("store.api.copy")}: ${label}`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? t("store.api.copied") : t("store.api.copy")}
        </button>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-code-ink">
        <code>{renderCode(code, highlight)}</code>
      </pre>
    </div>
  );
}
