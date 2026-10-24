import type { ReactNode } from "react";
import { PageBand } from "./PageBand";
import { SiteFooter, SiteHeader } from "./SiteChrome";

export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  items?: Array<{ label: string; text: string }>;
};

/** 規約・ポリシーの本文。英語版は参考訳で、notice に「日本語版が優先する」旨を出す */
export function LegalPage({
  title,
  notice,
  children,
}: {
  title: string;
  notice?: string;
  children: ReactNode;
}) {
  return (
    <div className="site min-h-screen bg-surface font-sans text-ink antialiased">
      <SiteHeader />
      <PageBand title={title} size="sm" />
      <section>
        <div className="ui-container max-w-3xl! py-12 lg:py-16">
          {notice && (
            <p className="mb-10 rounded-xl border border-line bg-paper px-5 py-4 text-sm leading-6 text-ink-soft">
              {notice}
            </p>
          )}
          {children}
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}

export function LegalSections({
  sections,
  effectiveDate,
}: {
  sections: LegalSection[];
  effectiveDate: string;
}) {
  return (
    <div className="space-y-12">
      {sections.map((section) => (
        <div key={section.heading}>
          <h2 className="text-base font-semibold text-ink">{section.heading}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p className="mt-3 text-[15px] leading-[1.9] text-ink-soft" key={paragraph.slice(0, 32)}>
              {paragraph}
            </p>
          ))}
          {section.items && (
            <ul className="mt-3 list-disc space-y-2 pl-6">
              {section.items.map((item) => (
                <li className="text-[15px] leading-[1.9] text-ink-soft" key={item.label}>
                  <strong className="font-semibold text-ink">{item.label}</strong> {item.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="text-base font-semibold">{effectiveDate}</p>
    </div>
  );
}

/** 英語版の冒頭に出す注記 */
export const TRANSLATION_NOTICE =
  "This English version is a translation provided for convenience. If it differs from the Japanese version, the Japanese version prevails.";
