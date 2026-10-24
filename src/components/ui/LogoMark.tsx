import { useId } from "react";

/**
 * Forkline のマーク。文字色 (currentColor) で塗るので、暗い面でも明るい面でも読める。
 * public/logo.svg と同じ形 (円から分岐の線を切り抜く)。
 */
export function LogoMark({ className = "h-4 w-4" }: { className?: string }) {
  const maskId = `logo-cut-${useId().replace(/:/g, "")}`;
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden focusable="false">
      <defs>
        <mask id={maskId}>
          <rect width="24" height="24" fill="#fff" />
          <g fill="none" stroke="#000" strokeWidth="2.8" strokeLinejoin="round">
            <path d="M-1 12H9.5" />
            <path d="M9.5 12C13 12 14.5 7.5 25 2.5" />
            <path d="M9.5 12C13 12 14.5 16.5 25 21.5" />
          </g>
        </mask>
      </defs>
      <circle cx="12" cy="12" r="11.5" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}
