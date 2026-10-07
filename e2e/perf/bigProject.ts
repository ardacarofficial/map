/**
 * The perf harness's big project, generated with core (same format the
 * editor writes): a 1024×1024 map of 32 px tiles, 4 tile layers, every cell
 * painted with a pseudo-random tile of `overworld-32.png` (64 tiles), some
 * flipped. Deterministic (fixed LCG seed).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { FLIP_H, FLIP_V, MapDocument, MapStore, makeCell, serializeLevel, serializeProject, type CellWrite, type Tileset } from "../../packages/core/src/index";

export const BIG_SIZE = 1024;
export const BIG_LAYERS = 4;

const TILESET: Tileset = {
  id: "overworld",
  name: "overworld",
  imagePath: "tilesets/overworld-32.png",
  tileWidth: 32,
  tileHeight: 32,
  columns: 8,
  rows: 8,
  margin: 0,
  spacing: 0,
};

export interface ProjectFiles {
  /** Project-relative path → text or bytes. */
  readonly files: ReadonlyMap<string, string | Uint8Array>;
}

export function generateBigProject(size = BIG_SIZE, layers = BIG_LAYERS): ProjectFiles {
  const doc = new MapDocument({ width: size, height: size, tileWidth: 32, tileHeight: 32 });
  const store = new MapStore(doc, { historyLimit: 0 });
  store.dispatch({ type: "addTileset", tileset: TILESET });
  const palette: number[] = [];
  for (let t = 0; t < 64; t++) palette.push(store.getOrAddPaletteIndex(TILESET.id, t));
  let seed = 12345;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let l = 0; l < layers; l++) {
    const layerId = store.dispatch({ type: "addLayer", layer: { name: `Katman ${l + 1}` } });
    // Row bands keep the write arrays moderate.
    for (let y0 = 0; y0 < size; y0 += 64) {
      const cells: CellWrite[] = [];
      for (let y = y0; y < Math.min(size, y0 + 64); y++) {
        for (let x = 0; x < size; x++) {
          const r = rnd();
          const flags = (r & 0x100 ? FLIP_H : 0) | (r & 0x200 ? FLIP_V : 0);
          cells.push({ x, y, cell: makeCell(palette[(r >>> 16) & 63]!, flags) });
        }
      }
      store.dispatch({ type: "paintCells", layerId, cells });
    }
  }
  const level = serializeLevel(doc);
  const project = serializeProject({ name: "Perf", levels: [{ name: "main", path: "levels/main.json" }], tilesets: [TILESET] });
  const png = readFileSync(fileURLToPath(new URL("../../samples/tilesets/overworld-32.png", import.meta.url)));
  return {
    files: new Map<string, string | Uint8Array>([
      ["project.smap", project],
      ["levels/main.json", level],
      ["tilesets/overworld-32.png", new Uint8Array(png)],
    ]),
  };
}
