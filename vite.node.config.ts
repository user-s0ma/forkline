// Node のサーバー向けに組み立てる (npm run build:node)。出力は build-node/。
// Cloudflare 向けの vite.config.ts との違い: Cloudflare のプラグインを使わず、サーバーの入口を src/server/app.ts にする
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { readFileSync } from "fs";
import path from "path";

// 画面のコードに埋め込む公開の値 (VITE_PUBLIC_*) は、Cloudflare 向けと同じく wrangler.jsonc の vars から取る。
// 環境変数で渡されていればそちらを使う
const wranglerVars: Record<string, string> =
  JSON.parse(
    readFileSync(path.resolve(__dirname, "wrangler.jsonc"), "utf8")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,(\s*[}\]])/g, "$1"),
  ).vars ?? {};
for (const [key, value] of Object.entries(wranglerVars)) {
  if (key.startsWith("VITE_PUBLIC_") && !process.env[key]) process.env[key] = value;
}

export default defineConfig({
  plugins: [reactRouter(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  environments: {
    // React Router はこの input を見て、サーバーの入口を差し替える
    ssr: { build: { rollupOptions: { input: "./src/server/app.ts" } } },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/lucide-react")) {
            return "lucide-icons";
          }
        },
      },
    },
  },
});
