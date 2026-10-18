import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cellFlags, cellPaletteIndex, makeCell, serializeLevel } from "../src";
import { planTileReplacement } from "../src/replaceTiles";
import { makeStore, TILESET } from "./helpers";

const from = { tilesetId: TILESET.id, tileId: 0 };
const to = { tilesetId: TILESET.id, tileId: 1 };

describe("planTileReplacement", () => {
  it("preserves every flag, leaves nonmatches untouched, is deterministic/idempotent and undoes/redoes exactly", () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 7 })), { minLength: 1, maxLength: 256 }), values => {
      const { store, ground, top } = makeStore(32, 32, 3);
      const original = values.map(([index, flags], i) => ({ x: i & 31, y: i >> 5, cell: makeCell(index, flags << 29) }));
      for (const layerId of [ground, top]) store.dispatch({ type: "paintCells", layerId, cells: original });
      store.clearHistory();
      const before = serializeLevel(store.document);
      const options = { from, to, layerIds: [ground, top] };
      const plan = planTileReplacement(store.document, options);
      expect(planTileReplacement(store.document, options)).toEqual(plan);
      expect(serializeLevel(store.document)).toBe(before);
      store.beginTransaction();
      for (const p of plan) store.dispatch({ type: "paintCells", ...p });
      store.commit();
      const after = serializeLevel(store.document);
      for (const layerId of [ground, top]) for (const p of original) {
        const actual = store.document.getLayer(layerId)!.getCell(p.x, p.y);
        expect(actual).toBe(cellPaletteIndex(p.cell) === 1 ? makeCell(2, cellFlags(p.cell)) : p.cell);
      }
      expect(planTileReplacement(store.document, options)).toEqual([]);
      if (plan.length) {
        expect(store.undoDepth).toBe(1);
        store.undo();
        expect(serializeLevel(store.document)).toBe(before);
        store.redo();
        expect(serializeLevel(store.document)).toBe(after);
      } else expect(store.undoDepth).toBe(0);
    }));
  });

  it("clips selection, deduplicates layers and skips locked, hidden, grid, entity and missing layers", () => {
    const { store, ground, top } = makeStore(64, 64);
    const collision = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
    const entity = store.dispatch({ type: "addLayer", layer: { name: "Entities", type: "entity" } });
    for (const layerId of [ground, top]) store.dispatch({ type: "paintCells", layerId, cells: [{ x: 31, y: 32, cell: 1 }, { x: 32, y: 32, cell: 1 }] });
    store.dispatch({ type: "setLayerProps", layerId: top, props: { locked: true } });
    const options = { from, to, layerIds: [ground, ground, top, collision, entity, "missing"], region: { x: 32, y: 32, width: 100, height: 100 } };
    expect(planTileReplacement(store.document, options)).toEqual([{ layerId: ground, cells: [{ x: 32, y: 32, cell: 2 }] }]);
    store.dispatch({ type: "setLayerProps", layerId: ground, props: { visible: false } });
    expect(planTileReplacement(store.document, options)).toEqual([]);
  });

  it("matches full tile identity and plans a new target index without mutating the palette", () => {
    const { store, ground } = makeStore(4, 4, 1);
    store.dispatch({ type: "addTileset", tileset: { ...TILESET, id: "other" } });
    const other = store.getOrAddPaletteIndex("other", 0);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: 1 }, { x: 1, y: 0, cell: other }] });
    expect(planTileReplacement(store.document, { from, to, layerIds: [ground] })).toEqual([{ layerId: ground, cells: [{ x: 0, y: 0, cell: 3 }] }]);
    expect(store.document.palette.size).toBe(2);
    expect(planTileReplacement(store.document, { from, to: from, layerIds: [ground] })).toEqual([]);
    expect(planTileReplacement(store.document, { from, to: { ...to, tileId: 999 }, layerIds: [ground] })).toEqual([]);
  });
});
