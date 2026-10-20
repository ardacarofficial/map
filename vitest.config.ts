import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/core", "packages/agent", "packages/editor", "packages/desktop", "packages/agent-cli/test/vitest.config.ts", "packages/editor/dev/vitest.config.ts"],
    passWithNoTests: true,
  },
});
