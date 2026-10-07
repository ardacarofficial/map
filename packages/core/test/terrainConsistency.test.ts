/**
 * Derived terrain tiles stay equal to `deriveTerrainTiles` after any op:
 * paste / stamp / cut of terrain grid + derived tile layers, hand painting
 * on a derived layer, layer add/remove, tileset add, resize, undo / redo.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  copyRegion,
  createStamp,
  cutRegion,
  flipClip,
  makeCell,
  pasteClip,
  placeStamp,
  serializeLevel,
  type Tileset,
} from "../src";
import { BLOB_ID, CORNER_ID, TERRAIN_TILESET, derivedMismatches, makeTerrainStore } from "./helpers";

function fill(store: ReturnType<typeof makeTerrainStore>, value: number, x0: number, y0: number, x1: number, y1: number) {
  const cells = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push({ x, y, value });
  store.dispatch({ type: "paintTerrain", layerId: "terrain", cells });
}

describe("paste / stamp of terrain grid + derived tile layer", () => {
  it("a stamp placed over identical terrain leaves the derived tiles consistent", () => {
    const src = makeTerrainStore(12, 12);
    fill(src, BLOB_ID, 2, 2, 4, 4);
    const stamp = createStamp(src.document, ["tiles", "terrain"], { x: 2, y: 2, width: 3, height: 3 }, { id: "s", name: "S" });

    const dst = makeTerrainStore(12, 12);
    fill(dst, BLOB_ID, 0, 0, 11, 11);
    expect(derivedMismatches(dst.document)).toEqual([]);
    const depth = dst.undoDepth;
    placeStamp(dst, stamp, 5, 5);
    expect(derivedMismatches(dst.document)).toEqual([]);
    expect(dst.undoDepth).toBe(depth); // nothing changed: identical terrain, re-derived tiles equal
  });

  it("pasting a clip into a derived tile layer re-derives instead of copying raw tiles (one undo step)", () => {
    const store = makeTerrainStore(12, 12);
    fill(store, CORNER_ID, 1, 1, 2, 2);
    const clip = copyRegion(store.document, ["terrain", "tiles"], { x: 0, y: 0, width: 4, height: 4 });
    const before = serializeLevel(store.document);
    const depth = store.undoDepth;
    pasteClip(store, flipClip(clip, "x"), null, 6, 6);
    expect(derivedMismatches(store.document)).toEqual([]);
    expect(store.undoDepth).toBe(depth + 1);
    store.undo();
    expect(serializeLevel(store.document)).toBe(before);
  });

  it("a tile-only clip pasted into a derived layer changes nothing and adds no palette entries", () => {
    const store = makeTerrainStore(12, 12);
    fill(store, BLOB_ID, 1, 1, 3, 3);
    const clip = copyRegion(store.document, ["tiles"], { x: 0, y: 0, width: 5, height: 5 });
    const before = serializeLevel(store.document);
    expect(pasteClip(store, clip, { tiles: "tiles" }, 6, 6)).toEqual([]);
    expect(serializeLevel(store.document)).toBe(before);
  });

  it("cut of the grid clears its derived tiles, cut of only the derived layer keeps them", () => {
    const store = makeTerrainStore(12, 12);
    fill(store, CORNER_ID, 2, 2, 6, 6);
    cutRegion(store, ["tiles"], { x: 3, y: 3, width: 2, height: 2 });
    expect(derivedMismatches(store.document)).toEqual([]);
    cutRegion(store, ["terrain"], { x: 3, y: 3, width: 2, height: 2 });
    expect(derivedMismatches(store.document)).toEqual([]);
    cutRegion(store, ["tiles", "terrain"], { x: 5, y: 5, width: 3, height: 3 });
    expect(derivedMismatches(store.document)).toEqual([]);
  });
});

describe("ops that touch derived layers", () => {
  it("paintCells on a derived tile layer is skipped like on a locked layer", () => {
    const store = makeTerrainStore(8, 8);
    const index = store.getOrAddPaletteIndex("terrain", 5);
    const patch = store.dispatch({ type: "paintCells", layerId: "tiles", cells: [{ x: 1, y: 1, cell: makeCell(index) }] });
    expect(patch.cells).toEqual([]);
    expect(store.document.getLayer("tiles")!.getCell(1, 1)).toBe(0);
    expect(store.undoDepth).toBe(0);
  });

  it("a new terrain grid takes over its target: hand-painted tiles are cleared in the same undo step", () => {
    const store = makeTerrainStore(8, 8);
    store.dispatch({ type: "addLayer", layer: { id: "hand", name: "Hand" } });
    const index = store.getOrAddPaletteIndex("terrain", 5);
    store.dispatch({ type: "paintCells", layerId: "hand", cells: [{ x: 2, y: 2, cell: makeCell(index) }] });
    const depth = store.undoDepth;
    store.dispatch({ type: "addLayer", layer: { id: "g2", name: "G2", type: "grid", role: "terrain", targetLayerId: "hand" } });
    expect(derivedMismatches(store.document)).toEqual([]);
    expect(store.document.getLayer("hand")!.getCell(2, 2)).toBe(0);
    expect(store.undoDepth).toBe(depth + 1);
    store.undo();
    expect(store.document.getLayer("hand")!.getCell(2, 2)).toBe(makeCell(index));
  });

  it("re-adding a removed target layer id derives it", () => {
    const store = makeTerrainStore(8, 8);
    store.dispatch({ type: "removeLayer", layerId: "tiles" });
    fill(store, BLOB_ID, 1, 1, 3, 3);
    store.dispatch({ type: "addLayer", layer: { id: "tiles", name: "Tiles again" } });
    expect(store.document.getLayer("tiles")!.chunkCount).toBeGreaterThan(0);
    expect(derivedMismatches(store.document)).toEqual([]);
  });

  it("adding a tileset whose terrain an existing grid value names derives it", () => {
    const store = makeTerrainStore(8, 8);
    fill(store, 7, 1, 1, 3, 3); // terrain 7 is not defined yet: derives nothing
    expect(store.document.getLayer("tiles")!.chunkCount).toBe(0);
    const extra: Tileset = {
      ...TERRAIN_TILESET,
      id: "extra",
      imagePath: "tilesets/extra.png",
      terrains: [{ id: 7, name: "X", tilesetId: "extra", template: "corner16", origin: { col: 0, row: 0 } }],
    };
    store.dispatch({ type: "addTileset", tileset: extra });
    expect(store.document.getLayer("tiles")!.chunkCount).toBeGreaterThan(0);
    expect(derivedMismatches(store.document)).toEqual([]);
  });

  it("deriveTerrain op re-derives a rectangle and is a no-op on a consistent level", () => {
    const store = makeTerrainStore(8, 8);
    fill(store, BLOB_ID, 1, 1, 3, 3);
    const depth = store.undoDepth;
    expect(store.dispatch({ type: "deriveTerrain", layerId: "terrain" }).cells).toEqual([]);
    expect(store.dispatch({ type: "deriveTerrain", layerId: "terrain", rect: { x: -5, y: -5, width: 100, height: 3 } }).cells).toEqual([]);
    expect(store.undoDepth).toBe(depth);
    expect(() => store.dispatch({ type: "deriveTerrain", layerId: "tiles" })).toThrow(/not a grid layer/);
  });
});

type A = { k: string; [key: string]: number | string | boolean };
const num = (v: number | string | boolean | undefined): number => Number(v);
const coord = fc.integer({ min: -3, max: 14 });
const opArb: fc.Arbitrary<A> = fc.oneof(
  fc.record({ k: fc.constant("paint"), layer: fc.constantFrom("tiles", "t2"), x: coord, y: coord, v: fc.nat({ max: 4 }) }),
  fc.record({ k: fc.constant("terrain"), x: coord, y: coord, v: fc.constantFrom(0, BLOB_ID, CORNER_ID, 3), w: fc.nat({ max: 3 }) }),
  fc.record({ k: fc.constant("resize"), w: fc.integer({ min: 1, max: 16 }), h: fc.integer({ min: 1, max: 16 }), dx: fc.integer({ min: -4, max: 4 }), dy: fc.integer({ min: -4, max: 4 }) }),
  fc.record({ k: fc.constant("paste"), x: coord, y: coord, w: fc.integer({ min: 1, max: 5 }), h: fc.integer({ min: 1, max: 5 }), tx: coord, ty: coord, which: fc.nat({ max: 2 }), erase: fc.boolean() }),
  fc.record({ k: fc.constant("stamp"), x: coord, y: coord, w: fc.integer({ min: 1, max: 5 }), h: fc.integer({ min: 1, max: 5 }), tx: coord, ty: coord, flip: fc.boolean() }),
  fc.record({ k: fc.constant("cut"), x: coord, y: coord, w: fc.integer({ min: 1, max: 5 }), h: fc.integer({ min: 1, max: 5 }), which: fc.nat({ max: 2 }) }),
  fc.record({ k: fc.constant("defineTerrain"), template: fc.constantFrom("corner16", "blob47-godot", "blob47") }),
  fc.record({ k: fc.constant("removeTerrain"), id: fc.constantFrom(BLOB_ID, CORNER_ID) }),
  fc.record({ k: fc.constant("removeTiles") }),
  fc.record({ k: fc.constant("addTiles") }),
  fc.record({ k: fc.constant("addT2") }),
  fc.record({ k: fc.constant("move"), i: fc.nat({ max: 3 }) }),
  fc.record({ k: fc.constant("begin") }),
  fc.record({ k: fc.constant("commit") }),
  fc.record({ k: fc.constant("rollback") }),
  fc.record({ k: fc.constant("undo") }),
  fc.record({ k: fc.constant("redo") }),
);

const LAYER_SETS: readonly (readonly string[])[] = [["terrain", "tiles"], ["tiles"], ["terrain"]];

function snapshot(store: ReturnType<typeof makeTerrainStore>): string {
  // The palette is append-only (never undone); compare everything else.
  return serializeLevel(store.document).replace(/"palette": \[[\s\S]*?\],\n {2}"layers"/, '"layers"');
}

describe("property: derived terrain tiles always equal deriveTerrainTiles", () => {
  it("after every op, undo all restores, redo all replays", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        const store = makeTerrainStore(12, 12);
        for (let t = 0; t < 5; t++) store.getOrAddPaletteIndex("terrain", 100 + t);
        const initial = snapshot(store);
        for (const op of ops) {
          const doc = store.document;
          const has = (id: string) => doc.getLayer(id) !== undefined;
          switch (op.k) {
            case "paint":
              if (!has(String(op.layer))) break;
              store.dispatch({ type: "paintCells", layerId: String(op.layer), cells: [{ x: num(op.x), y: num(op.y), cell: op.v === 0 ? 0 : makeCell(doc.palette.size - num(op.v) + 1) }] });
              break;
            case "terrain": {
              const cells = [];
              for (let i = 0; i <= num(op.w); i++) cells.push({ x: num(op.x) + i, y: num(op.y), value: num(op.v) });
              store.dispatch({ type: "paintTerrain", layerId: "terrain", cells });
              break;
            }
            case "resize":
              store.dispatch({ type: "resizeMap", width: num(op.w), height: num(op.h), offsetX: num(op.dx), offsetY: num(op.dy) });
              break;
            case "paste": {
              const ids = LAYER_SETS[num(op.which)]!.filter(has);
              if (ids.length === 0) break;
              const clip = copyRegion(doc, ids, { x: num(op.x), y: num(op.y), width: num(op.w), height: num(op.h) });
              pasteClip(store, clip, null, num(op.tx), num(op.ty), { emptyCells: op.erase ? "erase" : "skip" });
              break;
            }
            case "stamp": {
              const ids = ["tiles", "terrain"].filter(has);
              if (ids.length === 0) break;
              const stamp = createStamp(doc, ids, { x: num(op.x), y: num(op.y), width: num(op.w), height: num(op.h) }, { id: "s", name: "S" });
              placeStamp(store, stamp, num(op.tx), num(op.ty), op.flip ? { flip: { x: true } } : {});
              break;
            }
            case "cut": {
              const ids = LAYER_SETS[num(op.which)]!.filter(has);
              if (ids.length > 0) cutRegion(store, ids, { x: num(op.x), y: num(op.y), width: num(op.w), height: num(op.h) });
              break;
            }
            case "defineTerrain":
              store.dispatch({ type: "defineTerrain", terrain: { id: BLOB_ID, name: "G", tilesetId: "terrain", template: String(op.template) as "corner16", origin: { col: 0, row: 0 } } });
              break;
            case "removeTerrain":
              if (doc.getTerrain(num(op.id))) store.dispatch({ type: "removeTerrain", terrainId: num(op.id) });
              break;
            case "removeTiles":
              if (has("tiles")) store.dispatch({ type: "removeLayer", layerId: "tiles" });
              break;
            case "addTiles":
              if (!has("tiles")) store.dispatch({ type: "addLayer", layer: { id: "tiles", name: "Tiles" } });
              break;
            case "addT2":
              if (!has("t2")) store.dispatch({ type: "addLayer", layer: { id: "t2", name: "T2" } });
              break;
            case "move":
              if (num(op.i) < doc.layers.length) store.dispatch({ type: "moveLayer", layerId: "terrain", index: num(op.i) });
              break;
            case "begin":
              store.beginTransaction();
              break;
            case "commit":
              if (store.inTransaction) store.commit();
              break;
            case "rollback":
              if (store.inTransaction) store.rollback();
              break;
            case "undo":
              store.undo();
              break;
            case "redo":
              store.redo();
              break;
          }
          expect(derivedMismatches(store.document)).toEqual([]);
        }
        while (store.inTransaction) store.commit();
        const final = snapshot(store);
        let n = 0;
        while (store.undo()) {
          n++;
          expect(derivedMismatches(store.document)).toEqual([]);
        }
        expect(snapshot(store)).toBe(initial);
        for (let i = 0; i < n; i++) store.redo();
        expect(snapshot(store)).toBe(final);
      }),
      { numRuns: 400 },
    );
  }, 120_000);
});
