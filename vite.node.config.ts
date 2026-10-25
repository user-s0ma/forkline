// Node のサーバー向けに組み立てる (npm run build:node)。出力は build-node/。
// Cloudflare 向けの vite.config.ts との違い: Cloudflare のプラグインを使わず、サーバーの入口を src/server/app.ts にする
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import path from "path";

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
