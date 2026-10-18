/** CPU snapshot+PNG microbenchmark, separate from application latency scenarios.
 * PERF_PORT=5941 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @smap/e2e exec playwright test -c perf/thumbnail-bench.config.ts
 */
import { defineConfig } from "@playwright/test";

const port = Number(process.env.PERF_PORT ?? 5941);
export default defineConfig({
  testDir: ".",
  testMatch: "thumbnail-bench.ts",
  outputDir: "./results/thumbnail-bench-output",
  timeout: 180_000,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `pnpm --filter @smap/editor dev --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
