/**
 * Standalone browser core benchmark; never auto-runs with pnpm perf.
 * Start Vite dev on an assigned spare port, then:
 * PERF_BENCH_URL=http://localhost:PORT pnpm --filter @smap/e2e exec node --experimental-strip-types perf/v14-core-bench.ts
 * PERF_BASE_REF selects the original fill.ts (default: this lane's base).
 * SMAP_PERF=1 enforces the 1024² core commit / preview budgets.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser } from "@playwright/test";
import type { CellMaskImage } from "../../packages/editor/src/canvas/cellMask";
import type { CellPoint, CellWrite, MapStore, TileLayer } from "../../packages/core/src";

import type * as Report from "./report";

type Mode = "point" | "runs";
interface Hooks {
  setup(width: number, height: number, layers: number): void;
  preview(mode: Mode): number;
  commit(mode: Mode): number;
  reset(): void;
}
type BenchWindow = Window & { __fillBench: Hooks };

const root = fileURLToPath(new URL("../../", import.meta.url));
const baseURL = process.env.PERF_BENCH_URL;
if (!baseURL) throw new Error("Set PERF_BENCH_URL to Vite dev on an assigned spare port");
const baseRef = process.env.PERF_BASE_REF ?? "7099f10";
const samples = Number(process.env.PERF_BENCH_RUNS ?? 15);
if (!Number.isInteger(samples) || samples < 1) throw new Error("PERF_BENCH_RUNS must be positive");
const warmups = 5;
const resultsDir = join(root, "e2e/perf/results");
const legacyPath = join(root, "packages/core/src/.fill-perf-before.ts");
const legacy = execFileSync("git", ["show", baseRef + ":packages/core/src/fill.ts"], { cwd: root, encoding: "utf8" });
const stats = await import(new URL("./report.ts", import.meta.url).href) as typeof Report;
let browser: Browser | undefined;
let created = false;
try {
  // Exclusive creation avoids overwriting a user's scratch file.
  writeFileSync(legacyPath, legacy, { flag: "wx" });
  created = true;
  browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(baseURL);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(async ({ coreUrl, legacyUrl }) => {
    const core = await import(/* @vite-ignore */ String(coreUrl));
    const old = await import(/* @vite-ignore */ String(legacyUrl));
    const plans = await import(/* @vite-ignore */ String("/src/canvas/fillRegionPlan.ts"));
    const masks = await import(/* @vite-ignore */ String("/src/canvas/cellMask.ts"));
    let state: { store: MapStore; layer: TileLayer; width: number; height: number; preview: { image: CellMaskImage | null; mask: Uint8Array } | null } | null = null;
    const current = () => {
      if (!state) throw new Error("Fixture is not ready");
      return state;
    };
    (window as unknown as BenchWindow).__fillBench = {
      setup(width, height, layers) {
        const store: MapStore = new core.MapStore(core.createDocument({ width, height }));
        store.dispatch({ type: "addTileset", tileset: { id: "bench", name: "Bench", imagePath: "tilesets/bench.png", tileWidth: 32, tileHeight: 32, columns: 64, rows: 64, margin: 0, spacing: 0 } });
        for (let i = 0; i < 4096; i++) store.getOrAddPaletteIndex("bench", i);
        const ids = Array.from({ length: layers }, (_, i) => store.dispatch({ type: "addLayer", layer: { name: "Layer " + i } }));
        store.clearHistory();
        state = { store, layer: store.document.getLayer(ids[0]!)!, width, height, preview: null };
      },
      preview(mode) {
        const s = current();
        const origin = { x: s.width >> 2, y: s.height >> 2 };
        const start = performance.now();
        if (mode === "point") {
          const points = old.floodFill(s.layer, origin.x, origin.y, -1, s.store.document.map);
          s.preview = { image: masks.cellMaskImage(points), mask: masks.membershipMask(points, s.width, s.height) };
        } else {
          const plan = plans.fillRegionPlan(s.store, s.layer, origin);
          s.preview = { image: plan.image, mask: plan.mask };
        }
        const elapsed = performance.now() - start;
        if (s.preview?.mask.reduce((sum, value) => sum + value, 0) !== s.width * s.height || s.preview.image?.data.length !== s.width * s.height * 4) throw new Error("Incorrect preview");
        return elapsed;
      },
      commit(mode) {
        const s = current();
        const click = { x: s.width >> 1, y: s.height >> 1 };
        if (s.preview?.mask[click.y * s.width + click.x] !== 1) throw new Error("Click is outside preview");
        const start = performance.now();
        // Match ToolController: region lookup precedes the transaction; palette
        // resolution and every validated write remain inside one transaction.
        const points: CellPoint[] = mode === "point" ? old.floodFill(s.layer, click.x, click.y, -1, s.store.document.map) : [];
        const runs = mode === "runs" ? plans.fillRegionPlan(s.store, s.layer, click).runsAt(click) : [];
        s.store.beginTransaction();
        const value = core.makeCell(s.store.getOrAddPaletteIndex("bench", 9));
        let cells: CellWrite[];
        if (mode === "point") {
          cells = [];
          for (const p of points) if (s.layer.getCell(p.x, p.y) !== value) cells.push({ x: p.x, y: p.y, cell: value });
        } else {
          cells = plans.fillRunWrites(runs, s.layer.getCell(click.x, click.y), () => value);
        }
        const patch = s.store.dispatch({ type: "paintCells", layerId: s.layer.id, cells });
        s.store.commit();
        const elapsed = performance.now() - start;
        if (core.patchCellCount(patch) !== s.width * s.height || s.store.undoDepth !== 1) throw new Error("Incorrect fill or transaction");
        return elapsed;
      },
      reset() {
        const s = current();
        if (!s.store.undo() || s.layer.chunkCount !== 0) throw new Error("Undo did not restore empty layer");
        if (!s.store.redo() || s.layer.getCell(0, 0) === 0) throw new Error("Redo did not restore fill");
        s.store.undo();
        s.store.clearHistory();
        state = null;
      },
    };
  }, { coreUrl: "/@fs/" + join(root, "packages/core/src/index.ts"), legacyUrl: "/@fs/" + legacyPath });

  const fixtures = [];
  for (const [width, height, layers] of [[128, 96, 8], [1024, 1024, 4]] as const) {
    const values = { point: { preview: [] as number[], commit: [] as number[] }, runs: { preview: [] as number[], commit: [] as number[] } };
    // Alternate A/B order to avoid always giving one variant the quieter slot.
    for (let i = -warmups; i < samples; i++) {
      const order: Mode[] = (i & 1) === 0 ? ["point", "runs"] : ["runs", "point"];
      for (const mode of order) {
        await page.evaluate(({ width, height, layers }) => (window as unknown as BenchWindow).__fillBench.setup(width, height, layers), { width, height, layers });
        await cdp.send("HeapProfiler.collectGarbage");
        const preview = await page.evaluate((mode) => (window as unknown as BenchWindow).__fillBench.preview(mode), mode);
        await cdp.send("HeapProfiler.collectGarbage");
        const commit = await page.evaluate((mode) => (window as unknown as BenchWindow).__fillBench.commit(mode), mode);
        await page.evaluate(() => (window as unknown as BenchWindow).__fillBench.reset());
        if (i >= 0) { values[mode].preview.push(preview); values[mode].commit.push(commit); }
      }
    }
    const summary = Object.fromEntries((Object.keys(values) as Mode[]).map((mode) => [mode, Object.fromEntries((["preview", "commit"] as const).map((phase) => [phase, { median: stats.median(values[mode][phase]), p95: stats.percentile(values[mode][phase], 95), n: values[mode][phase].length }]))]));
    fixtures.push({ width, height, layers, values, summary });
    console.log(width + "x" + height + ": " + JSON.stringify(summary));
  }
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(join(resultsDir, "v14-core-bench.json"), JSON.stringify({ date: new Date().toISOString(), browser: browser.version(), node: process.version, baseRef, warmups, samples, fixture: "Empty target, 4096 palette entries; core store with no UI/renderer subscribers; GC outside timing", fixtures }, null, 2) + "\n");
  if (process.env.SMAP_PERF === "1") {
    const large = fixtures[1]!.values.runs;
    if (stats.median(large.commit) > 450 || stats.percentile(large.preview, 95) > 13) throw new Error("Core fill / preview budget exceeded; inspect results");
  }
} finally {
  try { await browser?.close(); }
  finally { if (created) rmSync(legacyPath); }
}
