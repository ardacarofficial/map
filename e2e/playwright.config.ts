import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 5199);

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  timeout: 60_000,
  // Deferred PNG encoding and modal handoffs can exceed 10s on shared CI CPUs.
  // Functional assertions keep their values; explicit frame budgets remain unchanged.
  expect: { timeout: 30_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /connected-pick-timing\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
        },
      },
    },
    {
      // Timing assertions need an idle renderer, after parallel functional coverage.
      name: "chromium-timing",
      testMatch: /connected-pick-timing\.spec\.ts$/,
      dependencies: ["chromium"],
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
        },
      },
    },
  ],
  webServer: {
    command: `pnpm --filter @smap/editor dev --port ${PORT} --strictPort`,
    env: {
      HARITA_DEV_MCP: "1",
      HARITA_MCP_TOKEN: process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol",
      HARITA_DEV_MCP_PORT: process.env.E2E_MCP_PORT ?? "48766",
    },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
