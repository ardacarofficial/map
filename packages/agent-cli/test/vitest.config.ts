import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({ root: fileURLToPath(new URL("../", import.meta.url)), test: { include: ["test/**/*.test.ts"], environment: "node", testTimeout: 30000, expect: { poll: { timeout: 10000 } } } });
