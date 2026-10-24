import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { localizeHref, useLocale } from "@/lib/i18n";
import { LogoMark } from "@/components/ui/LogoMark";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const NAV_LINKS = [
  ["site.nav.explore", "/models"],
  ["site.nav.docs", "/docs"],
] as const;

const FOOTER_COLUMNS: Array<{
  h: string;
  links: Array<[labelKey: string, href: string]>;
}> = [
  {
    h: "site.footer.product",
    links: [
      ["site.footer.explore", "/models"],
      ["site.footer.publish", "/app"],
      ["site.footer.api", "/docs"],
    ],
  },
  {
    h: "site.footer.supportHeading",
    links: [
      ["site.footer.terms", "/terms"],
      ["site.footer.privacy", "/privacy"],
      ["site.footer.tokushoho", "/tokushoho"],
      ["site.footer.contact", "mailto:support@forkline.ai"],
    ],
  },
];

export function Logo() {
  return (
    <span className="flex items-center gap-1.5">
      <LogoMark />
      <span className="text-lg font-bold tracking-[-0.02em]">Forkline</span>
    </span>
  );
}

export function SiteHeader({
  transparentAtTop = false,
}: {
  transparentAtTop?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [scrolled, setScrolled] = useState(!transparentAtTop);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!transparentAtTop) return;
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [transparentAtTop]);

  return (
    <header className="sticky inset-x-0 top-0 z-30 px-3 pt-3 sm:px-4">
      <nav
        className={`mx-auto flex h-14 max-w-6xl items-center justify-between rounded-full border pr-2 pl-5 transition-colors duration-300 ${
          scrolled || menuOpen
            ? "border-line bg-surface/80 backdrop-blur-md"
            : "border-transparent bg-transparent"
        }`}
      >
        <a href={localizeHref("/", locale)} aria-label="Forkline">
          <Logo />
        </a>
        <div className="hidden items-center gap-1 rounded-full border border-line bg-paper/70 p-1 md:flex">
          {NAV_LINKS.map(([labelKey, href]) => (
            <a
              key={href}
              href={localizeHref(href, locale)}
              className="rounded-full px-4 py-1.5 text-sm text-ink-soft transition-colors hover:bg-line hover:text-ink"
            >
              {t(labelKey)}
            </a>
          ))}
        </div>
        <div className="hidden items-center gap-1 md:flex">
          <ThemeToggle className="mr-1" />
          <a
            href="/login"
            className="rounded-full px-4 py-2 text-sm text-ink-soft transition-colors hover:text-ink"
          >
            {t("site.login")}
          </a>
          <a
            href="/app"
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-hover"
          >
            {t("site.nav.publish")}
          </a>
        </div>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft md:hidden"
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={t("site.menu")}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>
      {menuOpen && (
        <div className="mx-auto mt-2 max-w-6xl animate-[rise_0.3s_both] rounded-3xl border border-line bg-surface/95 p-4 backdrop-blur-md md:hidden">
          {NAV_LINKS.map(([labelKey, href]) => (
            <a
              key={href}
              href={localizeHref(href, locale)}
              onClick={() => setMenuOpen(false)}
              className="block border-b border-line py-3 text-base"
            >
              {t(labelKey)}
            </a>
          ))}
          <ThemeToggle className="mt-4" />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <a
              href="/login"
              className="rounded-full border border-line-strong px-4 py-2.5 text-center text-sm"
            >
              {t("site.login")}
            </a>
            <a
              href="/app"
              className="rounded-full bg-brand px-4 py-2.5 text-center text-sm font-semibold text-on-brand"
            >
              {t("site.nav.publish")}
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [year] = useState(() => new Date().getFullYear());

  return (
    <footer className="border-t border-line">
      <div className="ui-container py-16">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-mute">
              {t("site.footer.tagline")}
            </p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.h}>
              <div className="text-sm font-semibold text-ink">{t(col.h)}</div>
              <ul className="mt-4 space-y-2.5">
                {col.links.map(([labelKey, href]) => (
                  <li key={labelKey}>
                    <a
                      href={localizeHref(href, locale)}
                      className="text-sm text-ink-mute transition-colors hover:text-ink"
                    >
                      {t(labelKey)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col items-start justify-between gap-2 border-t border-line pt-8 sm:flex-row sm:items-center">
          <p className="text-sm text-ink-mute">
            © {year} Forkline. All rights reserved.
          </p>
          <LanguageSwitcher />
        </div>
      </div>
    </footer>
  );
}
