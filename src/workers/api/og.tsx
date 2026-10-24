import { Hono } from "hono";
import { cache, GoogleFont, ImageResponse } from "@cf-wasm/og/workerd";
import { OG_LOCALE, translate } from "@/lib/i18n";
import { findPublicModel } from "./store";
import type { ApiEnv } from "./types";

/*
 * リンクを共有したときに出る OG 画像 (1200×630)。
 * 暗い面 (サイトの既定テーマ) にモデル名を大きく置き、ライムは下端の帯とモデル ID だけに使う。
 * 画像の描画では CSS 変数が使えないため、色は globals.css の暗いテーマの値を写してある。
 * フォントは使う文字だけを Google Fonts から取り寄せ、Workers の CPU とメモリに収める。
 * 共有先の閲覧者の言語は分からないため、文言は英語に固定する (モデル名などの中身はそのまま)。
 */

const WIDTH = 1200;
const HEIGHT = 630;
const CANVAS = "#1a1d1b";
const INK = "#e8ebe6";
const SOFT = "#bcc3bb";
const MUTE = "#9ba39a";
const LINE = "#343a35";
const BRAND = "#d4f54c";
const BRAND_INK = "#d4f54c";
const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";

const og = new Hono<ApiEnv>();

function LogoMark({ size }: { size: number }) {
  // マスクの代わりに地の色の線を重ねて切れ目を描く (同じ面の上なので見た目は同じ)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11.5" fill={INK} />
      <g fill="none" stroke={CANVAS} strokeWidth="2.8" strokeLinejoin="round">
        <path d="M-1 12H9.5" />
        <path d="M9.5 12C13 12 14.5 7.5 25 2.5" />
        <path d="M9.5 12C13 12 14.5 16.5 25 21.5" />
      </g>
    </svg>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: CANVAS,
        fontFamily: "Plex",
        color: INK,
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "64px 80px 56px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LogoMark size={40} />
          <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.6 }}>Forkline</span>
        </div>
        {children}
      </div>
      <div style={{ height: 14, background: BRAND, display: "flex" }} />
    </div>
  );
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function render(element: React.ReactNode, text: string, monoText: string) {
  // 使う文字だけのサブセットを読み込む (日本語の全グリフは Workers には重すぎる)
  const fonts = [
    new GoogleFont("IBM Plex Sans JP", { name: "Plex", weight: 700, text }),
    new GoogleFont("IBM Plex Sans JP", { name: "Plex", weight: 400, text }),
  ];
  if (monoText) {
    fonts.push(new GoogleFont("IBM Plex Mono", { name: "Mono", weight: 500, text: monoText }));
  }
  const response = await ImageResponse.async(element, { width: WIDTH, height: HEIGHT, fonts });
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", CACHE_CONTROL);
  return new Response(response.body, { status: response.status, headers });
}

og.use("*", async (c, next) => {
  cache.setExecutionContext(c.executionCtx);
  await next();
});

/** サイト全体の OG 画像 */
og.get("/site", async () => {
  // トップページの見出しと同じく、行の途中で折り返さないよう2行に分けて描く
  const lines = [translate(OG_LOCALE, "landing.hero.title1"), translate(OG_LOCALE, "landing.hero.title2")];
  const subtitle = translate(OG_LOCALE, "site.og.subtitle");
  const url = "forkline.ai/v1";
  return render(
    <Frame>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 80, fontWeight: 700, lineHeight: 1.2, letterSpacing: -2 }}>
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
        <div style={{ marginTop: 24, fontSize: 32, color: SOFT, fontWeight: 400 }}>{subtitle}</div>
      </div>
      <div style={{ display: "flex" }}>
        <span
          style={{
            fontFamily: "Mono",
            fontSize: 26,
            color: BRAND_INK,
            border: `2px solid ${LINE}`,
            borderRadius: 999,
            padding: "10px 24px",
          }}
        >
          {url}
        </span>
      </div>
    </Frame>,
    `Forkline${lines.join("")}${subtitle}`,
    url,
  );
});

/** モデルごとの OG 画像 */
og.get("/models/:slug", async (c) => {
  const row = await findPublicModel(c.env, c.req.param("slug"));
  if (!row) return c.notFound();
  const { model } = row;
  const name = clip(model.name, 60);
  const tagline = clip(model.tagline, 90);
  const category = translate(OG_LOCALE, `store.categories.${model.category}`);
  const publisher = row.publisherName
    ? translate(OG_LOCALE, "store.detail.by", { publisher: clip(row.publisherName, 30) })
    : "";
  // 長い名前は文字を小さくして2行に収める
  const nameSize = name.length > 36 ? 60 : name.length > 22 ? 72 : 88;

  return render(
    <Frame>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div
          style={{
            fontSize: nameSize,
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: -1.5,
            display: "flex",
          }}
        >
          {name}
        </div>
        {tagline && (
          <div
            style={{ marginTop: 22, fontSize: 32, lineHeight: 1.45, color: SOFT, fontWeight: 400 }}
          >
            {tagline}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontFamily: "Mono",
            fontSize: 26,
            color: BRAND_INK,
            border: `2px solid ${LINE}`,
            borderRadius: 999,
            padding: "10px 24px",
          }}
        >
          {model.slug}
        </span>
        <span style={{ fontSize: 26, color: MUTE, fontWeight: 400, display: "flex", gap: 28 }}>
          <span>{category}</span>
          {publisher && <span>{publisher}</span>}
        </span>
      </div>
    </Frame>,
    `Forkline${name}${tagline}${category}${publisher}`,
    model.slug,
  );
});

export default og;
