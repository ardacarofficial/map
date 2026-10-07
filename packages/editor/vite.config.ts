import { defineConfig } from "vitest/config";

import { editorPlugins } from "./vite.plugins.ts";

export default defineConfig({
  plugins: editorPlugins(),
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks: app code changes often, Pixi and React do not (cache + parallel load).
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:pixi\.js|@pixi)[\\/]/.test(id)) return "pixi";
          if (/[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          return undefined;
        },
      },
    },
  },
  test: {
    name: "editor",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
