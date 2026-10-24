import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { listModels } from "@/lib/nebius/models";

/*
 * ヒーローの図。ベースモデルの線路から、あなたのデータで学習した LoRA の線がブランドカラー (ライム) で分岐し、
 * エンドポイントを通って、APIの呼び出し (売上) へ扇状に広がる。
 * 線は SVG、文字は HTML で重ねる (スマホで図が縮んでも文字の大きさを保つため)。座標は viewBox (400×240) の値。
 */

const W = 400;
const H = 240;
const FAN = [92, 132, 172];
const STATIONS = [140, 250];

const pos = (x: number, y: number): CSSProperties => ({
  left: `${(x / W) * 100}%`,
  top: `${(y / H) * 100}%`,
});

function Label({
  x,
  y,
  align = "center",
  children,
}: {
  x: number;
  y: number;
  align?: "left" | "center" | "right";
  children: ReactNode;
}) {
  const shift =
    align === "center"
      ? "-translate-x-1/2 text-center"
      : align === "right"
        ? "-translate-x-full text-right"
        : "";
  return (
    <div className={`absolute w-max max-w-[5.5rem] sm:max-w-[10rem] ${shift}`} style={pos(x, y)}>
      {children}
    </div>
  );
}

export function FlowDiagram() {
  const { t } = useTranslation();
  const base = listModels()[0]?.label ?? "Nemotron";
  const fork = "M56 48 C 96 48, 92 132, 132 132 H 316";

  return (
    <figure className="relative mx-auto w-full max-w-xl">
      <div className="relative aspect-[400/240] w-full" role="img" aria-label={t("landing.flow.aria")}>
        <svg
          className="absolute inset-0 h-full w-full overflow-visible"
          viewBox={`0 0 ${W} ${H}`}
          fill="none"
          aria-hidden
        >
          <defs>
            <linearGradient id="fl-base" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="var(--color-line-strong)" />
              <stop offset="0.75" stopColor="var(--color-line-strong)" />
              <stop offset="1" stopColor="var(--color-line-strong)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* ベースモデルの線路 */}
          <path d="M8 48 H400" stroke="url(#fl-base)" strokeWidth="4" strokeLinecap="round" />
          {/* 分岐した自分のモデルの線。初回だけ分岐点からなぞるように描く */}
          <path
            d={fork}
            stroke="var(--color-brand-ink)"
            strokeWidth="4"
            strokeLinecap="round"
            className="animate-[yard-route_1.4s_ease-out_both]"
          />
          {/* 呼び出しの扇: 線に沿ってリクエストが流れる */}
          {FAN.map((y) => {
            const d = `M316 132 C 352 132, 356 ${y}, 392 ${y}`;
            return (
              <g key={y}>
                <path d={d} stroke="var(--color-earn)" strokeOpacity="0.25" strokeWidth="2.5" />
                <path
                  d={d}
                  stroke="var(--color-earn)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray="6 18"
                  className="animate-[track-flow_1.2s_linear_infinite]"
                />
                <circle cx="392" cy={y} r="4" fill="var(--color-earn)" />
              </g>
            );
          })}
          {/* 分岐点と駅 */}
          <circle
            cx="56"
            cy="48"
            r="7"
            fill="var(--color-canvas)"
            stroke="var(--color-ink-mute)"
            strokeWidth="3"
          />
          {STATIONS.map((x) => (
            <circle
              key={x}
              cx={x}
              cy="132"
              r="9"
              fill="var(--color-canvas)"
              stroke="var(--color-brand-ink)"
              strokeWidth="4"
            />
          ))}
          <circle cx="316" cy="132" r="6" fill="var(--color-brand-ink)" />
        </svg>

        <Label x={8} y={0} align="left">
          <p className="text-xs text-ink-mute">{t("landing.flow.base")}</p>
          <p className="text-sm font-semibold whitespace-nowrap text-ink">{base}</p>
        </Label>
        <Label x={88} y={66} align="left">
          <p className="text-xs font-semibold whitespace-nowrap text-brand-ink sm:text-sm">
            {t("landing.flow.data")}
          </p>
        </Label>
        <Label x={STATIONS[0]} y={152}>
          <p className="text-xs font-semibold text-ink sm:text-sm">{t("landing.flow.train")}</p>
          <p className="mt-0.5 text-[11px] leading-tight text-ink-mute sm:text-xs">
            {t("landing.flow.trainMeta")}
          </p>
        </Label>
        <Label x={STATIONS[1]} y={152}>
          <p className="text-xs font-semibold text-ink sm:text-sm">{t("landing.flow.deploy")}</p>
          <p className="mt-0.5 text-[11px] leading-tight text-ink-mute sm:text-xs">
            {t("landing.flow.deployMeta")}
          </p>
        </Label>
        <Label x={400} y={200} align="right">
          <p className="text-xs font-semibold text-ink sm:text-sm">{t("landing.flow.calls")}</p>
          <p className="mt-0.5 text-[11px] leading-tight font-semibold text-earn sm:text-xs">
            {t("landing.flow.earn")}
          </p>
        </Label>
      </div>
      <pre className="mt-12 overflow-x-auto rounded-xl border border-line bg-code px-4 py-3 font-mono text-[12px] leading-5 text-code-ink sm:text-[13px]">
        <code>
          {"POST /v1/chat/completions\n"}
          {'{ "model": '}
          <span className="text-brand-ink">&quot;your-model&quot;</span>
          {', "messages": [ … ] }'}
        </code>
      </pre>
    </figure>
  );
}
