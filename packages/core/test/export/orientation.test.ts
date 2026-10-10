/**
 * FLIP_D (diagonal / rotation) through every exporter: draw list (PNG),
 * game JSON / Unity flags, TMJ GID bits. The pixel-exact PNG check lives in
 * the editor (`pngComposite.test.ts`).
 */
import { describe, expect, it } from "vitest";
import {
  createDocument,
  EXPORT_FLIP_D,
  EXPORT_FLIP_H,
  EXPORT_FLIP_V,
  exportGameJson,
  exportTmj,
  FLIP_D,
  FLIP_H,
  FLIP_V,
  layerDrawList,
  makeCell,
  MapStore,
  type Tileset,
} from "../../src";
import { TILESET } from "../helpers";

/** All eight flag combinations as `[cell bits, export bits]`, export bits = index. */
const COMBOS: [number, number][] = Array.from({ length: 8 }, (_, i) => [
  (i & EXPORT_FLIP_H ? FLIP_H : 0) | (i & EXPORT_FLIP_V ? FLIP_V : 0) | (i & EXPORT_FLIP_D ? FLIP_D : 0),
  i,
]);

/** 8×1 map, one cell per combination (x = export flags), tile 9 of `tileset`. */
function eightCells(tileset: Tileset = TILESET, cell = { width: 32, height: 32 }) {
  const store = new MapStore(createDocument({ width: 8, height: 1, tileWidth: cell.width, tileHeight: cell.height }));
  store.dispatch({ type: "addTileset", tileset });
  store.dispatch({ type: "addLayer", layer: { id: "l", name: "L" } });
  const p = store.getOrAddPaletteIndex(tileset.id, 9);
  store.dispatch({
    type: "paintCells",
    layerId: "l",
    cells: COMBOS.map(([bits, i]) => ({ x: i, y: 0, cell: makeCell(p, bits) })),
  });
  return store;
}

describe("orientation export", () => {
  it("draw list carries flipD and keeps square tiles in their cell", () => {
    const items = layerDrawList(eightCells().document).layers[0]!.items;
    expect(items).toHaveLength(8);
    items.forEach((item, i) => {
      expect([item.flipH, item.flipV, item.flipD]).toEqual([(i & 1) !== 0, (i & 2) !== 0, (i & 4) !== 0]);
      expect(item.dest).toEqual({ x: i * 32, y: 0, width: 32, height: 32 });
      expect(item.src).toEqual({ x: 32, y: 32, width: 32, height: 32 }); // tile 9 = col 1, row 1
    });
  });

  it("a diagonal flip transposes a non-square tile, anchored bottom-left of its cell", () => {
    const tall: Tileset = { ...TILESET, id: "tall", tileWidth: 16, tileHeight: 32, columns: 4, rows: 4 };
    const items = layerDrawList(eightCells(tall, { width: 16, height: 16 }).document).layers[0]!.items;
    // Unflipped: 16×32 rising above its 16×16 cell. Transposed: 32×16, flush with the cell.
    expect(items[0]!.dest).toEqual({ x: 0, y: -16, width: 16, height: 32 });
    expect(items[4]!.dest).toEqual({ x: 64, y: 0, width: 32, height: 16 });
    expect(items[5]!.dest).toEqual({ x: 80, y: 0, width: 32, height: 16 });
    expect(items[4]!.src).toEqual({ x: 16, y: 64, width: 16, height: 32 }); // source stays untransposed
  });

  it("game JSON writes D as 4 next to H = 1 and V = 2", () => {
    const game = JSON.parse(exportGameJson(eightCells().document)) as { layers: { cells: number[] }[] };
    const cells = game.layers[0]!.cells;
    const flags = [];
    for (let i = 0; i < cells.length; i += 5) flags.push(cells[i + 4]);
    expect(flags).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("TMJ copies the D bit as Tiled's 0x20000000 for every combination", () => {
    const tmj = JSON.parse(exportTmj(eightCells().document, "m").text) as { layers: { data: number[] }[] };
    const gid = 1 + 9;
    expect(tmj.layers[0]!.data).toEqual(COMBOS.map(([bits]) => (gid | bits) >>> 0));
    expect(tmj.layers[0]!.data[5]).toBe(0xa000_000a); // D+H = 90° clockwise
  });
});
