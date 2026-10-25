import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  appDirectory: "src/app",
  // Node 向け (vite.node.config.ts) は Cloudflare 向けと出力を分ける
  buildDirectory: process.env.FORKLINE_TARGET === "node" ? "build-node" : "build",
} satisfies Config;
