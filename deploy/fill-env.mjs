// deploy/prod.env の空の項目を、手元の .env から埋める。値は画面に出さない。
//   node deploy/fill-env.mjs
// 手元の開発と本番は同じ DB と Nebius を使うので、多くはそのまま使える。最後に、まだ空の項目の名前だけを出す
import { readFileSync, writeFileSync } from "node:fs";

const PROD = "deploy/prod.env";
const parse = (file) =>
  Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
  );

const dev = parse(".env");
// 手元の値のうち、本番では使わないもの
delete dev.VITE_PUBLIC_APP_URL;

const filled = [];
const lines = readFileSync(PROD, "utf8")
  .split(/\r?\n/)
  .map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=$/);
    if (!m) return line;
    const value = dev[m[1]] || "";
    if (!value) return line;
    filled.push(m[1]);
    // systemd の EnvironmentFile は1行1項目なので、改行は \n と書く。
    // 引用符なしだと \ が消える (\n が n になる) ので、\ を含む値は単引用符で囲む
    const text = value.replace(/\r?\n/g, "\\n");
    return `${m[1]}=${text.includes("\\") ? `'${text}'` : text}`;
  });
writeFileSync(PROD, lines.join("\n"));

const empty = lines.filter((l) => /^[A-Z0-9_]+=$/.test(l)).map((l) => l.slice(0, -1));
console.log(`埋めた項目: ${filled.length}`);
console.log(empty.length ? `まだ空: ${empty.join(" ")}` : "空の項目はありません");
