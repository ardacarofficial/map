/**
 * Palette entries whose tile id is outside their tileset (the PNG shrank;
 * tiles are only ever appended, so existing ids must stay put) or whose
 * tileset is gone: kept in the level, reported, and skipped by every export.
 */
import { describe, expect, it } from "vitest";
import {
  exportGameJson,
  exportTmj,
  exportUnityMap,
  exportWarnings,
  layerDrawList,
  makeCell,
  MapStore,
  paletteWarnings,
  parseLevel,
  serializeLevel,
  type Tileset,
} from "../src";
import { TILESET } from "./helpers";

const SMALL: Tileset = { ...TILESET, id: "a", imagePath: "a.png", columns: 2, rows: 2 };
const OTHER: Tileset = { ...TILESET, id: "b", imagePath: "b.png", columns: 2, rows: 2 };

/** Level whose palette index 1 is tile 5 of a 4-tile tileset, index 2 a valid tile of the next one. */
function levelText(): string {
  return JSON.stringify({
    format: "smap-level",
    documentFormatVersion: 1,
    map: { width: 2, height: 1, tileWidth: 32, tileHeight: 32 },
    palette: [
      { index: 1, tilesetId: "a", tileId: 5 },
      { index: 2, tilesetId: "b", tileId: 0 },
      { index: 3, tilesetId: "gone", tileId: 0 },
    ],
    layers: [{ id: "l", name: "L", type: "tile", visible: true, locked: false, opacity: 1, chunks: [] }],
  });
}

function setup() {
  const warnings: string[] = [];
  const doc = parseLevel(levelText(), [SMALL, OTHER], [], { warnings });
  const store = new MapStore(doc);
  store.dispatch({ type: "paintCells", layerId: "l", cells: [{ x: 0, y: 0, cell: makeCell(1) }, { x: 1, y: 0, cell: makeCell(3) }] });
  store.dispatch({ type: "addLayer", layer: { id: "l2", name: "L2" } });
  store.dispatch({ type: "paintCells", layerId: "l2", cells: [{ x: 0, y: 0, cell: makeCell(2) }] });
  return { doc, warnings };
}

describe("out-of-range tile ids", () => {
  it("parseLevel keeps them but reports them (warning, not an error)", () => {
    const { doc, warnings } = setup();
    expect(warnings).toEqual([
      'palette index 1: tile 5 is outside tileset "a" (4 tiles)',
      'palette index 3: tileset "gone" is not in the project',
    ]);
    expect(paletteWarnings(doc)).toEqual(warnings);
    expect(serializeLevel(parseLevel(serializeLevel(doc), [SMALL, OTHER]))).toBe(serializeLevel(doc));
  });

  it("TMJ skips the cell instead of overflowing into the next tileset's GIDs, and warns", () => {
    const { doc } = setup();
    const result = exportTmj(doc, "m");
    const tmj = JSON.parse(result.text);
    expect(tmj.layers[0].data).toEqual([0, 0]);
    expect(tmj.layers[1].data[0]).toBe(tmj.tilesets[tmj.tilesets.length - 1].firstgid);
    expect(result.warnings).toContain('Cells with tile ids outside tileset "a" were skipped: 5.');
    expect(result.warnings).toContain("Cells of missing tilesets were skipped: gone.");
  });

  it("game JSON, Unity map and the PNG draw list skip it too; Unity map and draw list carry warnings", () => {
    const { doc } = setup();
    const game = JSON.parse(exportGameJson(doc));
    expect(game.layers[0].cells).toEqual([]);
    expect(game.tilesets.map((t: { name: string }) => t.name)).toEqual(["Grass"]); // only "b" is used validly
    const unity = exportUnityMap(doc, "m");
    expect(unity.warnings).toEqual(exportWarnings(doc));
    expect(unity.warnings!.length).toBe(2);
    const list = layerDrawList(doc);
    expect(list.layers[0]!.items).toEqual([]);
    expect(list.warnings).toEqual(exportWarnings(doc));
  });

  it("a clean document exports without warnings", () => {
    const doc = parseLevel(levelText(), [SMALL, OTHER]);
    expect(exportWarnings(doc)).toEqual([]);
    expect(exportTmj(doc, "m").warnings).toEqual([]);
  });
});
