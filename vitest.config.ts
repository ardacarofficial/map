import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/core", "packages/editor", "packages/desktop"],
    passWithNoTests: true,
  },
});
