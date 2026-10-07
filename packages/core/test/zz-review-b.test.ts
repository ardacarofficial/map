import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { makeCell, serializeLevel, deriveTerrainTiles, isTileLayer } from "../src";
import { makeTerrainStore } from "./helpers";

type A = { k: string; [x: string]: any };
const opArb: fc.Arbitrary<A> = fc.oneof(
  fc.record({ k: fc.constant("paint"), layer: fc.constantFrom("tiles", "t2"), x: fc.integer({ min: -2, max: 20 }), y: fc.integer({ min: -2, max: 20 }), v: fc.nat({ max: 4 }) }),
  fc.record({ k: fc.constant("terrain"), x: fc.integer({ min: -1, max: 20 }), y: fc.integer({ min: -1, max: 20 }), v: fc.constantFrom(0, 1, 2, 3), w: fc.nat({ max: 3 }) }),
  fc.record({ k: fc.constant("resize"), w: fc.integer({ min: 1, max: 24 }), h: fc.integer({ min: 1, max: 24 }), dx: fc.integer({ min: -5, max: 5 }), dy: fc.integer({ min: -5, max: 5 }) }),
  fc.record({ k: fc.constant("begin") }),
  fc.record({ k: fc.constant("commit") }),
  fc.record({ k: fc.constant("rollback") }),
  fc.record({ k: fc.constant("undo") }),
  fc.record({ k: fc.constant("redo") }),
  fc.record({ k: fc.constant("removeTiles") }),
  fc.record({ k: fc.constant("addT2") }),
  fc.record({ k: fc.constant("move"), i: fc.nat({ max: 3 }) }),
);

function snapshot(store: any) {
  return serializeLevel(store.document).replace(/"palette": \[[\s\S]*?\],\n  "layers"/, '"layers"');
}

function checkDerived(store: any) {
  const doc = store.document;
  const grid = doc.getLayer("terrain");
  const target = doc.getLayer("tiles");
  if (!grid || !isTileLayer(target)) return;
  const expected = deriveTerrainTiles(doc, "terrain");
  const { width, height } = doc.map;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const e = expected[y * width + x];
    const c = target.getCell(x, y);
    const got = c === 0 ? null : doc.palette.get(c & 0x1fffffff);
    if (!!e !== !!got || (e && (e.tileId !== got.tileId))) throw new Error(`derived mismatch at ${x},${y}`);
  }
}

describe("fuzz", () => {
  it("random ops: undo all restores, redo all replays, derived stays consistent", () => {
    fc.assert(fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
      const store = makeTerrainStore(12, 12);
      for (let t = 0; t < 5; t++) store.getOrAddPaletteIndex("terrain", 100 + t);
      const initial = snapshot(store);
      let t2 = false;
      let manualTiles = false;
      for (const op of ops) {
        try {
          switch (op.k) {
            case "paint": if (op.layer === "t2" && !store.document.getLayer("t2")) break; if (op.layer === "tiles") manualTiles = true;
              store.dispatch({ type: "paintCells", layerId: op.layer, cells: [{ x: op.x, y: op.y, cell: op.v === 0 ? 0 : makeCell(store.document.palette.size - op.v + 1) }] }); break;
            case "terrain": { const cells = []; for (let i = 0; i <= op.w; i++) cells.push({ x: op.x + i, y: op.y, value: op.v });
              store.dispatch({ type: "paintTerrain", layerId: "terrain", cells }); break; }
            case "resize": store.dispatch({ type: "resizeMap", width: op.w, height: op.h, offsetX: op.dx, offsetY: op.dy }); break;
            case "begin": store.beginTransaction(); break;
            case "commit": if (store.inTransaction) store.commit(); break;
            case "rollback": if (store.inTransaction) store.rollback(); break;
            case "undo": store.undo(); break;
            case "redo": store.redo(); break;
            case "removeTiles": if (store.document.getLayer("t2")) store.dispatch({ type: "removeLayer", layerId: "t2" }); break;
            case "addT2": if (!store.document.getLayer("t2")) store.dispatch({ type: "addLayer", layer: { id: "t2", name: "T2" } }); break;
            case "move": if (op.i < store.document.layers.length) store.dispatch({ type: "moveLayer", layerId: "terrain", index: op.i }); break;
          }
        } catch (e) { throw new Error(`op ${JSON.stringify(op)} threw: ${(e as Error).message}`); }
        if (!manualTiles) checkDerived(store);
      }
      while (store.inTransaction) store.commit();
      const final = snapshot(store);
      let n = 0;
      while (store.undo()) n++;
      expect(snapshot(store)).toBe(initial);
      for (let i = 0; i < n; i++) store.redo();
      expect(snapshot(store)).toBe(final);
    }), { numRuns: 1500 });
  });
});
