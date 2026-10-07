import { defineConfig } from "vitest/config";

import { editorPlugins } from "./vite.plugins.ts";

export default defineConfig({
  plugins: editorPlugins(),
  test: {
    name: "editor",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
