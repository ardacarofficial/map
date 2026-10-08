/**
 * Undo bookkeeping micro-benchmark. Skipped unless `SMAP_PERF=1`:
 *   SMAP_PERF=1 pnpm vitest run --project core historyPerf --silent=false
 * Prints median timings; asserts only correctness.
 */
import { describe, expect, it } from "vitest";
import { createDocument, floodFill, makeCell, MapStore, type CellWrite } from "../src";
import { TILESET } from "./helpers";

// core has no DOM / Node typings (it must not depend on them); the runner provides these.
const host = globalThis as unknown as {
  process?: { env: Record<string, string | undefined> };
  performance: { now(): number };
  console: { log(message: string): void };
};
const env = host.process?.env ?? {};
const performance = host.performance;
const console = host.console;
const RUNS = Number(env.SMAP_PERF_RUNS ?? 5);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function setup(size: number) {
  const store = new MapStore(createDocument({ width: size, height: size }));
  store.dispatch({ type: "addTileset", tileset: TILESET });
  const a = store.getOrAddPaletteIndex(TILESET.id, 0);
  store.dispatch({ type: "addLayer", layer: { id: "l", name: "L" } });
  store.clearHistory();
  return { store, cell: makeCell(a) };
}

describe.skipIf(env.SMAP_PERF !== "1")("history perf", { timeout: 300_000 }, () => {
  it("fill of 1024×1024 cells in one transaction, undo, redo", () => {
    const fill: number[] = [];
    const undo: number[] = [];
    const redo: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const { store, cell } = setup(1024);
      const layer = store.document.getLayer("l")!;
      // Realistic cell order: the flood fill's scanline output.
      const writes: CellWrite[] = floodFill(layer, 0, 0, cell, store.document.map).map((p) => ({ x: p.x, y: p.y, cell }));
      expect(writes.length).toBe(1024 * 1024);
      let t = performance.now();
      store.beginTransaction();
      store.dispatch({ type: "paintCells", layerId: "l", cells: writes });
      store.commit();
      fill.push(performance.now() - t);
      t = performance.now();
      store.undo();
      undo.push(performance.now() - t);
      expect(layer.chunkCount).toBe(0);
      t = performance.now();
      store.redo();
      redo.push(performance.now() - t);
      expect(layer.chunkCount).toBe(1024);
    }
    console.log(
      `[perf] 1M-cell paintCells+commit ${median(fill).toFixed(1)} ms, undo ${median(undo).toFixed(1)} ms, redo ${median(redo).toFixed(1)} ms`,
    );
  });

  it("10k small strokes (each: transaction of 4 dabs of 3×3)", () => {
    const times: number[] = [];
    const undoTimes: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const { store, cell } = setup(512);
      const strokes: CellWrite[][][] = [];
      for (let s = 0; s < 10_000; s++) {
        const x0 = (s * 37) % 500;
        const y0 = (s * 91) % 500;
        const dabs: CellWrite[][] = [];
        for (let d = 0; d < 4; d++) {
          const dab: CellWrite[] = [];
          for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) dab.push({ x: x0 + d + dx, y: y0 + dy, cell: s % 2 ? cell : 0 });
          dabs.push(dab);
        }
        strokes.push(dabs);
      }
      const t = performance.now();
      for (const dabs of strokes) {
        store.beginTransaction();
        for (const dab of dabs) store.dispatch({ type: "paintCells", layerId: "l", cells: dab });
        store.commit();
      }
      times.push(performance.now() - t);
      const u = performance.now();
      while (store.undo());
      undoTimes.push(performance.now() - u);
    }
    console.log(`[perf] 10k strokes ${median(times).toFixed(1)} ms, undo all (1000 kept) ${median(undoTimes).toFixed(1)} ms`);
  });
});
