import fc from "fast-check";
import { expect, it } from "vitest";
import { createDocument, MapStore, serializeLevel } from "../src";

function setup() {
  const store = new MapStore(createDocument({
    width: 8, height: 8,
    tilesets: [{ id: "tiles", name: "Tiles", tileWidth: 16, tileHeight: 16, columns: 4, rows: 1, margin: 0, spacing: 0, imagePath: "tiles.png" }],
  }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  const entities = store.dispatch({ type: "addLayer", layer: { name: "Things", type: "entity" } });
  for (let i = 0; i < 4; i++) store.getOrAddPaletteIndex("tiles", i);
  store.clearHistory();
  return { store, layerId, entities };
}

it("rollbackTo undoes only changes after the savepoint and keeps the transaction open", () => {
  const { store, layerId, entities } = setup();
  store.beginTransaction("draft");
  store.dispatch({ type: "paintCells", layerId, cells: [{ x: 0, y: 0, cell: 1 }] });
  store.dispatch({ type: "addEntity", layerId: entities, entity: { id: "a", typeId: "spawn", x: 0, y: 0 } });
  const kept = serializeLevel(store.document);
  const savepoint = store.savepoint();
  store.dispatch({ type: "paintCells", layerId, cells: [{ x: 0, y: 0, cell: 2 }, { x: 1, y: 0, cell: 3 }] });
  store.dispatch({ type: "moveEntity", entityId: "a", x: 16, y: 16 });
  store.dispatch({ type: "setLayerProps", layerId, props: { locked: true } });
  store.rollbackTo(savepoint);
  expect(serializeLevel(store.document)).toBe(kept);
  expect(store.inTransaction).toBe(true);
  store.commit();
  expect(store.undoDepth).toBe(1);
  store.undo();
  expect(store.document.getLayer(layerId)!.getCell(0, 0)).toBe(0);
  store.redo();
  expect(serializeLevel(store.document)).toBe(kept);
});

it("savepoints require an open transaction and reject unknown positions", () => {
  const { store } = setup();
  expect(() => store.savepoint()).toThrow();
  expect(() => store.rollbackTo(0)).toThrow();
  store.beginTransaction();
  expect(() => store.rollbackTo(5)).toThrow();
  store.rollback();
});

it("property: any sequence of calls with some rolled back equals applying only the kept calls", () => {
  fc.assert(fc.property(fc.array(fc.record({
    cells: fc.array(fc.record({ x: fc.nat(7), y: fc.nat(7), cell: fc.nat(4) }), { minLength: 1, maxLength: 6 }),
    keep: fc.boolean(),
  }), { maxLength: 12 }), calls => {
    const a = setup(), b = setup();
    a.store.beginTransaction(); b.store.beginTransaction();
    for (const call of calls) {
      const savepoint = a.store.savepoint();
      a.store.dispatch({ type: "paintCells", layerId: a.layerId, cells: call.cells });
      if (!call.keep) a.store.rollbackTo(savepoint);
      else b.store.dispatch({ type: "paintCells", layerId: b.layerId, cells: call.cells });
    }
    expect(serializeLevel(a.store.document)).toBe(serializeLevel(b.store.document));
    a.store.commit(); b.store.commit();
    a.store.undo(); b.store.undo();
    expect(serializeLevel(a.store.document)).toBe(serializeLevel(b.store.document));
  }), { numRuns: 100 });
});
