import type * as CoreModule from "../../packages/core/src/index";
import type * as ThumbModule from "../../packages/editor/src/canvas/mapThumbnail";
import type * as EncoderModule from "../../packages/editor/src/platform/recentThumbnail";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { generateBigProject } from "./bigProject";

test("ready CPU snapshot + PNG on the 1024² × 4 fixture", async ({ page }) => {
  const fixture = generateBigProject();
  await page.goto("/");
  const result = await page.evaluate(async ({ corePath, level, png }) => {
    const thumbPath = "/src/canvas/mapThumbnail.ts";
    const encodePath = "/src/platform/recentThumbnail.ts";
    const { MapThumbnail } = await import(thumbPath) as typeof ThumbModule;
    const { captureMapThumbnail, afterCriticalWork } = await import(encodePath) as typeof EncoderModule;
    const { MapStore, parseLevel } = await import(corePath) as typeof CoreModule;
    const image = await createImageBitmap(new Blob([new Uint8Array(png)], { type: "image/png" }));
    const tileset = { id: "overworld", name: "overworld", imagePath: "tilesets/overworld-32.png", tileWidth: 32, tileHeight: 32, columns: 8, rows: 8, margin: 0, spacing: 0 };
    const store = new MapStore(parseLevel(level, [tileset]));
    const live = new MapThumbnail(store, () => image, () => {});
    while (live.pending) live.update(50); // preparation excluded; never called by production capture
    const times = [];
    for (let sample = 0; sample < 35; sample++) {
      // Production makes one optional capture at idle, not a burst of 35 PNGs
      // in a single long task. Scheduling wait is outside the measured work.
      await new Promise<void>((resolve) => { afterCriticalWork(resolve); });
      const start = performance.now();
      const url = captureMapThumbnail(live.snapshot()!);
      const elapsed = performance.now() - start;
      if (!url) throw new Error("snapshot failed");
      if (sample >= 4) times.push(elapsed);
    }
    live.destroy(); image.close();
    times.sort((a, b) => a - b);
    return { samples: times.length, median: times[Math.floor(times.length / 2)]!, p95: times[Math.ceil(times.length * 0.95) - 1]!, max: times.at(-1)! };
  }, {
    corePath: `/@fs${fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url))}`,
    level: fixture.files.get("levels/main.json") as string,
    png: [...fixture.files.get("tilesets/overworld-32.png") as Uint8Array],
  });
  console.log(`thumbnail snapshot+encode: ${JSON.stringify(result)}`);
  expect(result.samples).toBe(31);
  expect(result.p95).toBeLessThanOrEqual(8);
});
