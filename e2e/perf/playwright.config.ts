/**
 * Performance harness (`pnpm perf`), not part of `pnpm test:e2e`.
 *
 * Runs against a production build (`vite build` + `vite preview`) that only
 * adds the `window.__smap` debug hook (`VITE_SMAP_DEBUG=1`). Chromium uses
 * SwiftShader (CPU-rendered WebGL), so GPU-bound numbers are pessimistic;
 * the harness reports JS / main-thread time.
 *
 * Env:
 * - `PERF_LABEL`     result file name under `perf/results/` (default "latest")
 * - `PERF_RUNS`      repetitions of every editor scenario (default 5)
 * - `PERF_NO_BUILD`  reuse the build (skip it)
 * - `PERF_DIST`      build folder relative to packages/editor (default ../../e2e/perf/dist)
 * - `PERF_PROFILE=1` also write `.cpuprofile`s and a top-functions summary
 *                    (use with `PERF_UNMINIFIED=1` for readable names)
 */
import { defineConfig } from "@playwright/test";

export const PERF_PORT = Number(process.env.PERF_PORT ?? 5299);

const outDir = process.env.PERF_DIST ?? "../../e2e/perf/dist";
const minify = process.env.PERF_UNMINIFIED === "1" ? " --minify false" : "";
const build = process.env.PERF_NO_BUILD ? "" : `pnpm --filter @smap/editor exec vite build --outDir ${outDir} --emptyOutDir --logLevel warn${minify} && `;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.perf\.ts$/,
  outputDir: "./results/test-output",
  // Every scenario now repeats, including the real painting strokes. Leave
  // room for SwiftShader under concurrent lane load without changing workloads.
  timeout: 45 * 60_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PERF_PORT}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      args: [
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--enable-precise-memory-info",
        "--js-flags=--expose-gc",
      ],
    },
  },
  webServer: {
    command: `${build}pnpm --filter @smap/editor exec vite preview --outDir ${outDir} --port ${PERF_PORT} --strictPort`,
    url: `http://localhost:${PERF_PORT}`,
    env: { VITE_SMAP_DEBUG: "1" },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
