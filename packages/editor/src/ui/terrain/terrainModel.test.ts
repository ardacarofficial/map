import { BLOB_E, BLOB_N, getTerrainSet, tagBlockWithTemplate, withTerrainSet, type TerrainSet, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";

import { bestPerTemplate, roughRect } from "./terrainDraft";
import {
  blockTileIds,
  draftResult,
  nextTerrainColor,
  nextTerrainId,
  previewTiles,
  terrainOfTag,
  terrainOfTile,
  terrainSwatch,
  toggleTag,
  uniqueName,
  uniqueSetId,
  withoutTerrain,
  zoneAt,
} from "./terrainModel";

const base: Tileset = { id: "t", name: "T", imagePath: "t.png", tileWidth: 16, tileHeight: 16, columns: 12, rows: 12, margin: 0, spacing: 0 };

function withSet(set: TerrainSet, template: "corner16" | "blob47-godot", terrainId: number, origin = { col: 0, row: 0 }, background = 0): Tileset {
  return tagBlockWithTemplate(withTerrainSet(base, set), set.id, terrainId, template, origin, background);
}

const blobSet: TerrainSet = { id: "b", name: "Çimen", kind: "blob", terrains: [{ id: 1, name: "Çimen", color: "#5fb85f" }], tiles: [] };
const cornerSet: TerrainSet = {
  id: "c",
  name: "Arazi",
  kind: "corner",
  terrains: [
    { id: 1, name: "Çimen", color: "#5fb85f" },
    { id: 2, name: "Toprak", color: "#b5895a" },
  ],
  tiles: [],
};

describe("3×3 preview", () => {
  it("blob: nine tiles of the terrain (edges, corners, full centre)", () => {
    const ts = withSet(blobSet, "blob47-godot", 1);
    const set = getTerrainSet(ts, "b")!;
    const tiles = previewTiles(set, 1);
    expect(tiles).toHaveLength(9);
    expect(tiles.every((x) => x !== null)).toBe(true);
    expect(new Set(tiles).size).toBe(9);
    expect(tiles[4]).toBe(terrainSwatch(set, 1));
  });

  it("corner: the patch on the background; missing tiles are null", () => {
    const ts = withSet(cornerSet, "corner16", 1);
    const set = getTerrainSet(ts, "c")!;
    const tiles = previewTiles(set, 1);
    expect(tiles.every((x) => x !== null)).toBe(true);
    // Terrain 2 has no tiles yet.
    expect(previewTiles(set, 2).every((x) => x === null)).toBe(true);
  });
});

describe("picking a terrain from a tile", () => {
  it("blob → its terrain; corner → the terrain on most corners", () => {
    const ts = withSet(cornerSet, "corner16", 2, { col: 0, row: 0 }, 1);
    const set = getTerrainSet(ts, "c")!;
    expect(terrainOfTag(set, { tileId: 0, corners: [2, 1, 1, 1] })).toBe(1);
    expect(terrainOfTag(set, { tileId: 0, corners: [2, 2, 1, 0] })).toBe(2);
    expect(terrainOfTag(set, { tileId: 0, corners: [0, 0, 0, 0] })).toBe(0);
    const full = terrainSwatch(set, 2)!;
    expect(terrainOfTile(ts, full)).toEqual({ tilesetId: "t", setId: "c", terrainId: 2 });
    expect(terrainOfTile(ts, 140)).toBeNull();
  });
});

describe("Düzelt (hand tagging)", () => {
  it("zones: quadrants for corner sets, a 3×3 grid for blob sets", () => {
    expect(zoneAt("corner", 0.1, 0.1)).toEqual({ kind: "corner", corner: 0 });
    expect(zoneAt("corner", 0.9, 0.9)).toEqual({ kind: "corner", corner: 2 });
    expect(zoneAt("blob", 0.5, 0.5)).toEqual({ kind: "blob", bit: 0 });
    expect(zoneAt("blob", 0.5, 0.05)).toEqual({ kind: "blob", bit: BLOB_N });
  });

  it("corner toggles between the terrain and the background; all-zero drops the tag", () => {
    let set = toggleTag(cornerSet, 7, { kind: "corner", corner: 0 }, 2);
    expect(set.tiles).toEqual([{ tileId: 7, corners: [2, 0, 0, 0] }]);
    set = toggleTag(set, 7, { kind: "corner", corner: 0 }, 2);
    expect(set.tiles).toEqual([]);
    const withBg = toggleTag({ ...cornerSet, background: 1 }, 7, { kind: "corner", corner: 3 }, 2);
    expect(withBg.tiles).toEqual([{ tileId: 7, corners: [1, 1, 1, 2] }]);
  });

  it("blob centre toggles membership; zones toggle bits", () => {
    let set = toggleTag(blobSet, 3, { kind: "blob", bit: 0 }, 1);
    expect(set.tiles).toEqual([{ tileId: 3, terrainId: 1, mask: 0 }]);
    set = toggleTag(set, 3, { kind: "blob", bit: BLOB_E }, 1);
    expect(set.tiles[0]!.mask).toBe(BLOB_E);
    set = toggleTag(set, 3, { kind: "blob", bit: 0 }, 1);
    expect(set.tiles).toEqual([]);
  });

  it("withoutTerrain drops its tags / corners and a matching background", () => {
    const ts = withSet(cornerSet, "corner16", 2, { col: 0, row: 0 }, 1);
    const set = { ...getTerrainSet(ts, "c")! };
    const out = withoutTerrain(set, 1);
    expect(out.terrains.map((x) => x.id)).toEqual([2]);
    expect(out.background).toBeUndefined();
    expect(out.tiles.every((tag) => !tag.corners!.includes(1))).toBe(true);
  });
});

describe("define helpers", () => {
  it("ids, names and colours", () => {
    expect(uniqueSetId(base)).toBe("terrain-1");
    expect(uniqueSetId(withTerrainSet(base, { ...blobSet, id: "terrain-1" }))).toBe("terrain-2");
    expect(nextTerrainId(undefined)).toBe(1);
    expect(nextTerrainId(cornerSet)).toBe(3);
    expect(uniqueName("Çimen", ["Çimen", "Çimen 2"])).toBe("Çimen 3");
    expect(nextTerrainColor(cornerSet)).not.toBe("#5fb85f");
  });

  it("draftResult tags a new set or adds to an existing one of the same kind", () => {
    const fresh = draftResult(base, { template: "blob47-godot", origin: { col: 0, row: 0 }, setId: null, name: "Su", color: "#4F8FD6", background: 0 })!;
    expect(fresh.set.kind).toBe("blob");
    expect(fresh.set.terrains).toEqual([{ id: 1, name: "Su", color: "#4f8fd6" }]);
    expect(fresh.set.tiles).toHaveLength(47);
    const ts = withSet(cornerSet, "corner16", 1);
    const added = draftResult(ts, { template: "corner16", origin: { col: 4, row: 0 }, setId: "c", name: "Toprak 2", color: "#b5895a", background: 1 })!;
    expect(added.terrainId).toBe(3);
    expect(draftResult(ts, { template: "blob47-godot", origin: { col: 0, row: 4 }, setId: "c", name: "x", color: "#ffffff", background: 0 })).toBeNull();
    expect(draftResult(base, { template: "blob47-godot", origin: { col: 1, row: 0 }, setId: null, name: "x", color: "#ffffff", background: 0 })).toBeNull();
    expect(blockTileIds(base, "corner16", { col: 1, row: 1 })).toHaveLength(16);
  });

  it("rough rectangles and one candidate per template", () => {
    expect(roughRect({ col: 5, row: 2 }, { col: 1, row: 4 })).toEqual({ col: 1, row: 2, columns: 5, rows: 3 });
    const c = (template: "corner16" | "blob47-godot", score: number, col = 0) => ({ template, origin: { col, row: 0 }, score });
    expect(bestPerTemplate([c("corner16", 0.9), c("corner16", 0.8, 1), c("blob47-godot", 0.5)]).map((x) => x.template)).toEqual(["corner16", "blob47-godot"]);
    expect(bestPerTemplate([c("corner16", 0), c("blob47-godot", 0.2)]).map((x) => x.template)).toEqual(["blob47-godot"]);
    expect(bestPerTemplate([c("corner16", 0)])).toHaveLength(1);
  });
});
