import { type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useRevalidator } from "react-router";
import { ConsoleSelect } from "@/components/ui/ConsoleSelect";
import { LOCALES, switchLocale, useLocale } from "@/lib/i18n";

function FlagIcon({ src, className }: { src: string; className?: string }) {
  return (
    <img
      src={src}
      alt=""
      className={`${className ?? ""} w-auto! rounded object-cover ring-1 ring-line`}
    />
  );
}

const FLAG_ICONS = new Map<Locale, ComponentType<{ className?: string }>>(
  LOCALES.map(({ value, flag }) => [
    value,
    ({ className }: { className?: string }) => (
      <FlagIcon src={flag} className={className} />
    ),
  ]),
);

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const current = useLocale();
  const { i18n } = useTranslation();
  const revalidator = useRevalidator();
  return (
    <ConsoleSelect<Locale>
      value={current}
      options={LOCALES.map(({ value, label }) => ({
        value,
        label,
        icon: FLAG_ICONS.get(value),
      }))}
      onChange={(value) => {
        switchLocale(i18n, value);
        // サーバーで作る文言（ページの言語など）も、新しい言語で読み直す
        void revalidator.revalidate();
      }}
      ariaLabel="Language"
      className={className || "w-36"}
    />
  );
}
