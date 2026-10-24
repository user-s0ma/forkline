import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { listModels } from "@/lib/nebius/models";

/*
 * ヒーローの図。ベースモデルの駅から、そのままのモデルの線路と、あなたのデータで学習した LoRA の線 (ライム) の
 * 2本に分かれる。分岐はここだけにし、LoRA の線はエンドポイントを通って、APIの呼び出し (売上) へ流れる。
 * 線は SVG、文字は HTML で重ねる (スマホで図が縮んでも文字の大きさを保つため)。座標は viewBox (400×240) の値。
 */

const W = 400;
const H = 240;
const STATIONS = [140, 250];
/** ベースモデルの駅。自分のモデルの線はここから分かれる */
const BASE = { x: 36, y: 48 };

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
  const fork = `M${BASE.x} ${BASE.y} C ${BASE.x + 48} ${BASE.y}, 84 132, 132 132 H 316`;

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
            {/* 水平な線は高さが 0 なので、線の大きさ基準 (objectBoundingBox) だと描かれない。座標で指定する */}
            <linearGradient id="fl-base" gradientUnits="userSpaceOnUse" x1={BASE.x} x2={W} y1="0" y2="0">
              <stop offset="0" stopColor="var(--color-ink-mute)" />
              <stop offset="0.6" stopColor="var(--color-ink-mute)" stopOpacity="0.7" />
              <stop offset="1" stopColor="var(--color-ink-mute)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* ベースモデルの線路 (そのままのモデル) */}
          <path d={`M${BASE.x} ${BASE.y} H400`} stroke="url(#fl-base)" strokeWidth="4" strokeLinecap="round" />
          {/* 分岐した自分のモデルの線。初回だけ分岐点からなぞるように描く */}
          <path
            d={fork}
            stroke="var(--color-brand-ink)"
            strokeWidth="4"
            strokeLinecap="round"
            className="animate-[yard-route_1.4s_ease-out_both]"
          />
          {/* 呼び出し: 線に沿ってリクエストが流れる (分岐はベースモデルの1か所だけにするため、1本で描く) */}
          <path d="M316 132 H392" stroke="var(--color-earn)" strokeOpacity="0.25" strokeWidth="2.5" />
          <path
            d="M316 132 H392"
            stroke="var(--color-earn)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="6 18"
            className="animate-[track-flow_1.2s_linear_infinite]"
          />
          <circle cx="392" cy="132" r="4" fill="var(--color-earn)" />
          {/* ベースモデルの駅 (分岐の元) と、自分のモデルの駅 */}
          <circle
            cx={BASE.x}
            cy={BASE.y}
            r="11"
            fill="var(--color-canvas)"
            stroke="var(--color-ink)"
            strokeWidth="4"
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

        <Label x={BASE.x - 11} y={0} align="left">
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
        <Label x={400} y={152} align="right">
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
