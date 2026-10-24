/*
 * 表示テーマ (暗い / 明るい / 端末の設定に合わせる)。
 * 選んだ値は cookie に残し、<head> の中の小さなスクリプトが描画前に <html data-theme> を付ける。
 * これで読み込み直後に白い画面が一瞬出ることを防ぐ。JS が動かないときは暗いテーマのまま。
 */

export const THEME_COOKIE = "forkline_theme";
export const THEME_PREFS = ["system", "dark", "light"] as const;
export type ThemePref = (typeof THEME_PREFS)[number];

function isThemePref(value: unknown): value is ThemePref {
  return (THEME_PREFS as readonly unknown[]).includes(value);
}

/** サーバーで cookie から選んだ値を読む (トグルの初期表示用) */
export function themePrefFromRequest(request: Request): ThemePref {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|; *)${THEME_COOKIE}=([a-z]+)`));
  return isThemePref(match?.[1]) ? match[1] : "system";
}

/** 描画前に実行するスクリプト。root.tsx の <head> に埋め込む。端末の設定が変わったときも追従する */
export const THEME_INIT_SCRIPT = `(function(){try{
var d=document.documentElement,q=window.matchMedia("(prefers-color-scheme: light)"),m=document.cookie.match(/(?:^|; *)${THEME_COOKIE}=(system|dark|light)/),p=m?m[1]:"system";
function sys(){return q.matches?"light":"dark";}
d.setAttribute("data-theme-pref",p);d.setAttribute("data-theme",p==="system"?sys():p);
q.addEventListener("change",function(){if(d.getAttribute("data-theme-pref")==="system")d.setAttribute("data-theme",sys());});
}catch(e){}})();`;

/** 画面で選び直したときに呼ぶ。cookie に残して、すぐ <html> に反映する */
export function setThemePref(pref: ThemePref) {
  try {
    document.cookie = `${THEME_COOKIE}=${pref}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // cookie が使えない環境でも、この画面の表示だけは切り替える
  }
  applyThemePref(pref);
}

/**
 * <html> の data-theme を付け直す。React がハイドレーションに失敗して <html> を作り直すと
 * 描画前のスクリプトが付けた属性が消えるため、root.tsx からも呼ぶ。
 */
export function applyThemePref(pref?: ThemePref) {
  const root = document.documentElement;
  if (!pref) {
    let stored: string | undefined;
    try {
      stored = document.cookie.match(new RegExp(`(?:^|; *)${THEME_COOKIE}=([a-z]+)`))?.[1];
    } catch {
      stored = root.getAttribute("data-theme-pref") ?? undefined;
    }
    pref = isThemePref(stored) ? stored : "system";
  }
  let resolved: "dark" | "light" = pref === "light" ? "light" : "dark";
  if (pref === "system") {
    try {
      resolved = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    } catch {
      resolved = "dark";
    }
  }
  root.setAttribute("data-theme-pref", pref);
  root.setAttribute("data-theme", resolved);
}
