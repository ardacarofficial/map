/**
 * Terrains are project data, derived tiles are per level: a level saved
 * before a terrain changed elsewhere is re-derived when it is loaded.
 */
import { describe, expect, it } from "vitest";
import { MapStore, parseLevel, serializeLevel, type Tileset } from "../src";
import { BLOB_ID, CORNER_ID, derivedMismatches, makeTerrainStore } from "./helpers";

function paintedStore() {
  const store = makeTerrainStore(40, 40, 7);
  const cells = [];
  for (let y = 3; y < 12; y++) for (let x = 2; x < 9; x++) cells.push({ x, y, value: BLOB_ID });
  for (let y = 30; y < 34; y++) for (let x = 31; x < 38; x++) cells.push({ x, y, value: CORNER_ID });
  store.dispatch({ type: "paintTerrain", layerId: "terrain", cells });
  return store;
}

describe("parseLevel re-derives terrain layers", () => {
  it("an unchanged, consistent level loads and saves byte-identically", () => {
    const store = paintedStore();
    const text = serializeLevel(store.document);
    const doc = parseLevel(text, store.document.tilesets);
    expect(serializeLevel(doc)).toBe(text);
  });

  it("a level saved before its terrain was redefined is brought up to date on load", () => {
    const store = paintedStore();
    const stale = serializeLevel(store.document);
    // Another level (sharing the project tilesets) redefines the blob terrain.
    const other = new MapStore(parseLevel(stale, store.document.tilesets));
    other.dispatch({
      type: "defineTerrain",
      terrain: { id: BLOB_ID, name: "Grass", tilesetId: "terrain", template: "blob47-godot", origin: { col: 0, row: 4 } },
    });
    const tilesets: readonly Tileset[] = other.document.tilesets;

    const doc = parseLevel(stale, tilesets);
    expect(derivedMismatches(doc)).toEqual([]);
    expect(serializeLevel(doc)).not.toBe(stale);
    // Same result as editing the level with the new definitions open.
    expect(doc.getLayer("tiles")!.getCell(4, 6)).not.toBe(0);
  });

  it("without tilesets nothing is derived (no terrain is known, tiles are kept)", () => {
    const store = paintedStore();
    const text = serializeLevel(store.document);
    expect(serializeLevel(parseLevel(text))).toBe(text);
    expect(serializeLevel(parseLevel(text, store.document.tilesets, [], { deriveTerrain: false }))).toBe(text);
  });
});
