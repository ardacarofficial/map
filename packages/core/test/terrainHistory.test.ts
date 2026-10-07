// CLAUDE.md v0.3 "Bitti": a shape drawn with the terrain brush gets the right
// edge and corner tiles by itself, and undo gives back the old state byte for byte.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  cellPaletteIndex,
  deriveTerrainTiles,
  floodFill,
  lineCells,
  parseLevel,
  parseProject,
  rectCells,
  serializeLevel,
  serializeProject,
  type MapStore,
} from "../src";
import { BLOB_ID, CORNER_ID, makeTerrainStore, terrainArb } from "./helpers";

const W = 18;
const H = 15;
const coord = fc.integer({ min: -2, max: 20 });
const value = fc.constantFrom(0, BLOB_ID, CORNER_ID, 3);

const actionArb = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("stroke" as const),
      value,
      points: fc.array(fc.tuple(coord, coord), { minLength: 1, maxLength: 5 }),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("rect" as const), value, x0: coord, y0: coord, x1: coord, y1: coord }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("fill" as const), value, x: coord, y: coord }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("define" as const), terrain: terrainArb() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("remove" as const), id: fc.constantFrom(1, 2, 3) }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("resize" as const),
      width: fc.integer({ min: 1, max: 22 }),
      height: fc.integer({ min: 1, max: 22 }),
      offsetX: fc.integer({ min: -4, max: 4 }),
      offsetY: fc.integer({ min: -4, max: 4 }),
    }),
  },
  { weight: 3, arbitrary: fc.constant({ kind: "undo" as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: "redo" as const }) },
);
type Action = typeof actionArb extends fc.Arbitrary<infer A> ? A : never;

function setup(seed: number): MapStore {
  const store = makeTerrainStore(W, H, seed);
  // Palette entries are append-only (not undoable): put every tile in first so
  // the palette is the same before and after the random sequence.
  for (let t = 0; t < 120; t++) store.getOrAddPaletteIndex("terrain", t);
  store.dispatch({ type: "paintTerrain", layerId: "terrain", cells: rectCells(2, 2, 5, 4).map((p) => ({ ...p, value: BLOB_ID })) });
  store.clearHistory();
  return store;
}

const snap = (store: MapStore) =>
  serializeLevel(store.document) + serializeProject({ name: "p", levels: [], tilesets: store.document.tilesets });

/** The derived tile layer equals a from-scratch recompute of the terrain grid. */
function expectNoDrift(store: MapStore) {
  const doc = store.document;
  const tiles = doc.getLayer("tiles")!;
  const expected = deriveTerrainTiles(doc, "terrain");
  const { width, height } = doc.map;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = tiles.getCell(x, y);
      const actual = cell === 0 ? null : doc.palette.get(cellPaletteIndex(cell))!;
      expect(actual, `cell (${x}, ${y})`).toEqual(expected[y * width + x]);
    }
  }
}

function apply(store: MapStore, a: Exclude<Action, { kind: "undo" } | { kind: "redo" }>): void {
  const doc = store.document;
  switch (a.kind) {
    case "stroke": {
      // A brush drag: one transaction, dabs along Bresenham segments.
      store.beginTransaction();
      let [px, py] = a.points[0]!;
      for (const [x, y] of a.points) {
        const cells = lineCells(px, py, x, y).map((p) => ({ ...p, value: a.value }));
        store.dispatch({ type: "paintTerrain", layerId: "terrain", cells });
        px = x;
        py = y;
      }
      store.commit();
      return;
    }
    case "rect":
      store.dispatch({ type: "paintTerrain", layerId: "terrain", cells: rectCells(a.x0, a.y0, a.x1, a.y1, doc.map).map((p) => ({ ...p, value: a.value })) });
      return;
    case "fill": {
      const points = floodFill(doc.getLayer("terrain")!, a.x, a.y, a.value, doc.map);
      store.dispatch({ type: "paintTerrain", layerId: "terrain", cells: points.map((p) => ({ ...p, value: a.value })) });
      return;
    }
    case "define":
      store.dispatch({ type: "defineTerrain", terrain: a.terrain });
      return;
    case "remove":
      if (doc.getTerrain(a.id)) store.dispatch({ type: "removeTerrain", terrainId: a.id });
      return;
    case "resize":
      store.dispatch({ type: "resizeMap", width: a.width, height: a.height, offsetX: a.offsetX, offsetY: a.offsetY });
      return;
  }
}

describe("v0.3 Bitti: terrain strokes", () => {
  it("random strokes + undo all → identical bytes; derived tiles never drift from a full recompute", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.array(actionArb, { maxLength: 40 }), (seed, actions) => {
        const store = setup(seed);
        const initial = snap(store);
        const states = [initial];
        let at = 0;
        for (const a of actions) {
          if (a.kind === "undo") {
            if (store.undo()) at--;
          } else if (a.kind === "redo") {
            if (store.redo()) at++;
          } else {
            const depth = store.undoDepth;
            apply(store, a);
            if (store.undoDepth > depth) states.splice(++at, Infinity, snap(store));
          }
          expect(snap(store)).toBe(states[at]);
          expectNoDrift(store);
        }
        // Reopen: same bytes, same derivation (variants hash the persisted seed).
        const level = serializeLevel(store.document);
        const tilesets = parseProject(serializeProject({ name: "p", levels: [], tilesets: store.document.tilesets })).tilesets;
        const reopened = parseLevel(level, tilesets);
        expect(serializeLevel(reopened)).toBe(level);

        while (store.undo());
        expect(snap(store)).toBe(initial);
        expectNoDrift(store);
        while (store.redo());
        expect(snap(store)).toBe(states[states.length - 1]);
        expectNoDrift(store);
      }),
      { numRuns: 120 },
    );
  }, 60_000);
});
