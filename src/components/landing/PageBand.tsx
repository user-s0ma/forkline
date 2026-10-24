import type { ReactNode } from "react";

/**
 * 公開サイトの下層ページ用の見出し帯。トップと同じ夜の操車場の空気
 * (格子・ノイズ・ブランドカラーの光・等角の線路) を背景に敷き、見出しは左寄せにする。
 */
export function PageBand({
  title,
  subline,
  eyebrow,
  aside,
  children,
  leading,
  size = "md",
}: {
  /** タイトルの左に置く要素 (モデルのアイコンなど) */
  leading?: ReactNode;
  title: ReactNode;
  subline?: ReactNode;
  /** タイトルの上に置く要素 (戻るリンクなど) */
  eyebrow?: ReactNode;
  /** 右側に置く要素 */
  aside?: ReactNode;
  /** タイトルの下に置く要素 (検索欄・統計など) */
  children?: ReactNode;
  size?: "md" | "sm";
}) {
  return (
    <section className="relative isolate overflow-hidden border-b border-line">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="hero-backdrop absolute inset-0" />
        <div className="hero-noise absolute inset-0 opacity-60" />
        <svg
          className="absolute inset-y-0 right-0 h-full w-2/3 opacity-60 [mask-image:linear-gradient(to_left,black,transparent)]"
          preserveAspectRatio="none"
        >
          <defs>
            <pattern
              id="band-iso"
              width="56"
              height="32"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M0 16 L28 0 L56 16 L28 32 Z"
                fill="none"
                stroke="var(--color-ink)"
                strokeOpacity="0.06"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#band-iso)" />
        </svg>
        <div className="absolute -top-24 right-[12%] h-72 w-72 rounded-full bg-brand-tint blur-3xl" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-canvas" />
      </div>
      <div
        className={`ui-container relative ${size === "sm" ? "pt-10 pb-10 sm:pt-14" : "pt-12 pb-12 sm:pt-16 sm:pb-14"}`}
      >
        {eyebrow && <div className="mb-6">{eyebrow}</div>}
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 max-w-3xl items-start gap-5">
            {leading && <div className="shrink-0">{leading}</div>}
            <div className="min-w-0">
              <h1
                className={`h-display font-semibold tracking-[-0.03em] break-words ${size === "sm" ? "text-3xl sm:text-4xl" : "text-4xl sm:text-5xl"}`}
              >
                {title}
              </h1>
              {subline && (
                <p className="mt-4 max-w-2xl text-base leading-7 text-ink-soft">
                  {subline}
                </p>
              )}
            </div>
          </div>
          {aside && <div className="shrink-0">{aside}</div>}
        </div>
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}
