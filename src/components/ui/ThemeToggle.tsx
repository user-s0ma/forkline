import { useState } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { setThemePref, type ThemePref } from "@/lib/theme";

const OPTIONS: Array<[ThemePref, LucideIcon]> = [
  ["system", Monitor],
  ["dark", Moon],
  ["light", Sun],
];

/** 表示テーマの切り替え (端末に合わせる / ダーク / ライト) */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as { themePref?: ThemePref } | undefined;
  const [pref, setPref] = useState<ThemePref>(root?.themePref ?? "system");

  return (
    <div
      role="radiogroup"
      aria-label={t("theme.label")}
      className={`inline-flex items-center gap-0.5 rounded-full border border-line bg-paper p-0.5 ${className}`}
    >
      {OPTIONS.map(([value, Icon]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={t(`theme.${value}`)}
          title={t(`theme.${value}`)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-mute transition-colors hover:text-ink aria-checked:bg-raised aria-checked:text-ink aria-checked:ring-1 aria-checked:ring-line-strong"
          onClick={() => {
            setPref(value);
            setThemePref(value);
          }}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}
