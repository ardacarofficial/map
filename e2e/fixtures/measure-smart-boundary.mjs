/** Reproduce Round 2 rates. Run from the worktree root: node e2e/fixtures/measure-smart-boundary.mjs [seed count]. */
import process from "node:process";
import console from "node:console";
import { createServer } from "../../packages/editor/node_modules/vite/dist/node/index.js";
import { fileURLToPath, URL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url)), count = Number(process.argv[2] ?? 1000);
const server = await createServer({ root, configFile: false, logLevel: "silent", optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true } });
try {
  const { detectNineSliceSelection: detect, NINE_SLICE_DETECTOR_VERSION: version } = await server.ssrLoadModule(root + "/packages/core/src/smartStamp/detect.ts");
  const { boundaryArt } = await server.ssrLoadModule(root + "/packages/core/test/smartStampBoundaryArt.ts");
  const rows = [];
  for (const size of [16, 32]) {
    let accepted = 0;
    for (let seed = 1; seed <= count; seed++) if (detect(boundaryArt(seed, 6, 6, size))) accepted++;
    rows.push({ corpus: "exact-review-stone-seeds", size, total: count, accepted });
    let negatives = 0, positives = 0;
    for (let seed = 1; seed <= count; seed++) {
      const w = 5 + seed % 4, h = 5 + Math.floor(seed / 4) % 4, b = 2 + seed % 2, orientation = seed % 8;
      if (detect(boundaryArt(seed, w, h, size, ["stone", "plank", "grass"][seed % 3], 0, orientation))) negatives++;
      if (detect(boundaryArt(seed, Math.max(w, 2 * b + 1), Math.max(h, 2 * b + 1), size, ["road", "wall", "water"][seed % 3], b, orientation))) positives++;
    }
    rows.push({ corpus: "material-variations-seeds", size, total: count, accepted: negatives });
    rows.push({ corpus: "framed-grain-seeds", size, total: count, accepted: positives });
  }
  console.log(JSON.stringify({ detectorVersion: version, seeds: `1..${count}`, rows }, null, 2));
} finally { await server.close(); }
