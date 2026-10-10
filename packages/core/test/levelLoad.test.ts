/**
 * Terrains are project data, derived tiles are per level: a level saved
 * before a terrain changed elsewhere is re-derived when it is loaded.
 */
import { describe, expect, it } from "vitest";
import { cellFlags, cellPaletteIndex, parseLevel, serializeLevel, type MapDocument, type Tileset } from "../src";
import { BLOB_ID, CORNER_ID, derivedMismatches, makeTerrainStore } from "./helpers";

function paintedStore() {
  const store = makeTerrainStore(40, 40, 7);
  const cells = [];
  for (let y = 3; y < 12; y++) for (let x = 2; x < 9; x++) cells.push({ x, y, value: BLOB_ID });
  for (let y = 30; y < 34; y++) for (let x = 31; x < 38; x++) cells.push({ x, y, value: CORNER_ID });
  store.dispatch({ type: "paintTerrain", layerId: "terrain", cells });
  return store;
}

/** Every cell of a layer as the tile it shows (palette-order independent). */
function visibleTiles(doc: MapDocument, layerId: string): string[] {
  const layer = doc.getLayer(layerId)!;
  const out: string[] = [];
  for (let y = 0; y < doc.map.height; y++) {
    for (let x = 0; x < doc.map.width; x++) {
      const cell = layer.getCell(x, y);
      const entry = doc.palette.get(cellPaletteIndex(cell));
      out.push(entry ? `${entry.tilesetId}:${entry.tileId}:${cellFlags(cell)}` : "");
    }
  }
  return out;
}

/** The level JSON without its terrain grid layers (what a migrated level holds). */
function withoutTerrainGrids(text: string): unknown {
  const json = JSON.parse(text);
  json.documentFormatVersion = 2;
  json.layers = json.layers.filter((l: { role?: string }) => l.role !== "terrain");
  return json;
}

describe("parseLevel migrates terrain layers (format 1 → 2)", () => {
  it("a consistent level loads with identical tiles; the grid layer is gone; the result is stable", () => {
    const store = paintedStore();
    const text = serializeLevel(store.document);
    const doc = parseLevel(text, store.document.tilesets);
    const saved = serializeLevel(doc);
    expect(JSON.parse(saved)).toEqual(withoutTerrainGrids(text));
    expect(doc.migrations.length).toBe(1);
    expect(serializeLevel(parseLevel(saved, store.document.tilesets))).toBe(saved);
    expect(parseLevel(saved, store.document.tilesets).migrations).toEqual([]);
  });

  it("a level saved before its terrain was redefined is brought up to date before migrating", () => {
    const store = paintedStore();
    const stale = serializeLevel(store.document);
    // The project (legacy terrains still in memory) redefines the blob terrain.
    store.dispatch({
      type: "defineTerrain",
      terrain: { id: BLOB_ID, name: "Grass", tilesetId: "terrain", template: "blob47-godot", origin: { col: 0, row: 4 } },
    });
    expect(derivedMismatches(store.document)).toEqual([]);
    const tilesets: readonly Tileset[] = store.document.tilesets;
    const doc = parseLevel(stale, tilesets);
    expect(serializeLevel(doc)).not.toBe(stale);
    expect(visibleTiles(doc, "tiles")).toEqual(visibleTiles(store.document, "tiles"));
    expect(doc.getLayer("tiles")!.getCell(4, 6)).not.toBe(0);
  });

  it("without known terrains nothing is derived: the tiles on disk are kept", () => {
    const store = paintedStore();
    const text = serializeLevel(store.document);
    const expected = withoutTerrainGrids(text);
    expect(JSON.parse(serializeLevel(parseLevel(text)))).toEqual(expected);
    expect(JSON.parse(serializeLevel(parseLevel(text, store.document.tilesets, [], { deriveTerrain: false })))).toEqual(expected);
    const migrated = store.document.tilesets.map(({ terrains: _t, ...rest }) => rest);
    expect(JSON.parse(serializeLevel(parseLevel(text, migrated)))).toEqual(expected);
  });
});
