// 画面 (React Router) とサーバーの入口 (src/server/app.ts) を build/ に組み立てる。動かすのは server.mjs
// 画面に埋め込む公開の値 (VITE_PUBLIC_*) は、本番は .env.production、手元は .env から Vite が読む
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
  server: {
    hmr: {
      overlay: false,
    },
  },
});
