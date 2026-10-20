import { defineConfig } from "vitest/config";

import { editorAliases, editorCodeSplitting, editorPlugins } from "./vite.plugins.ts";

export default defineConfig({
  plugins: editorPlugins(),
  // Apply the shared policy to feature-owned popovers without editing their sources.
  resolve: { alias: editorAliases() },
  build: {
    // pixi.js alone is ~550 kB minified and cannot be split sensibly; anything above this is a real regression.
    chunkSizeWarningLimit: 600,
    rolldownOptions: { output: { codeSplitting: editorCodeSplitting() } },
  },
  test: {
    name: "editor",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
