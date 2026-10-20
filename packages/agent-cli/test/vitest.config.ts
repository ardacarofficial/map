import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({ root: fileURLToPath(new URL("../", import.meta.url)), test: { name: "agent-cli", globalSetup: [fileURLToPath(new URL("./build.ts", import.meta.url))], include: [fileURLToPath(new URL("./**/*.test.ts", import.meta.url))], environment: "node", testTimeout: 30000, expect: { poll: { timeout: 10000 } } } });
