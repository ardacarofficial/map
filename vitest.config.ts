import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/core", "packages/agent", "packages/editor", "packages/desktop"],
    passWithNoTests: true,
  },
});
