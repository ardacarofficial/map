import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FLIP_H,
  createDocument,
  makeCell,
  MapStore,
  serializeLevel,
  type StoreChangeEvent,
} from "../src";
import { TILESET, makeStore } from "./helpers";

function record(store: MapStore): StoreChangeEvent[] {
  const events: StoreChangeEvent[] = [];
  store.subscribe((e) => events.push(e));
  return events;
}

describe("MapStore basics", () => {
  it("paints cells and returns the patch", () => {
    const { store, ground, cell } = makeStore();
    const patch = store.dispatch({
      type: "paintCells",
      layerId: ground,
      cells: [{ x: 1, y: 2, cell: cell(1) }, { x: 40, y: 2, cell: cell(2, FLIP_H) }],
    });
    expect(patch).toEqual({
      layerId: ground,
      cells: [
        { x: 1, y: 2, before: 0, after: cell(1) },
        { x: 40, y: 2, before: 0, after: cell(2, FLIP_H) },
      ],
    });
    expect(store.document.getLayer(ground)?.getCell(40, 2)).toBe(cell(2, FLIP_H));
  });

  it("skips out-of-bounds writes and no-op writes", () => {
    const { store, ground, cell } = makeStore(10, 10);
    const patch = store.dispatch({
      type: "paintCells",
      layerId: ground,
      cells: [{ x: -1, y: 0, cell: cell(1) }, { x: 10, y: 0, cell: cell(1) }, { x: 0, y: 10, cell: cell(1) }, { x: 0, y: 0, cell: 0 }],
    });
    expect(patch.cells).toEqual([]);
    expect(store.document.getLayer(ground)?.chunkCount).toBe(0);
    expect(store.canUndo).toBe(false);
  });

  it("validates ops", () => {
    const { store, ground } = makeStore(10, 10, 2);
    expect(() => store.dispatch({ type: "paintCells", layerId: "nope", cells: [] })).toThrow(/unknown layer/);
    expect(() => store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: makeCell(3) }] })).toThrow(/palette index 3/);
    expect(() => store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: -1 }] })).toThrow(/invalid cell/);
    expect(() => store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0.5, y: 0, cell: 0 }] })).toThrow(/integers/);
    expect(() => store.dispatch({ type: "addTileset", tileset: TILESET })).toThrow(/duplicate/);
    expect(() => store.dispatch({ type: "addTileset", tileset: { ...TILESET, id: "x", imagePath: "../x.png" } })).toThrow(/imagePath/);
    expect(() => store.dispatch({ type: "addLayer", layer: { id: ground, name: "dup" } })).toThrow(/duplicate/);
    expect(() => store.dispatch({ type: "addLayer", layer: { name: "x", opacity: 2 } })).toThrow(/opacity/);
    expect(() => store.dispatch({ type: "addPaletteEntry", tilesetId: "nope", tileId: 0 })).toThrow(/unknown tileset/);
    expect(() => store.dispatch({ type: "addPaletteEntry", tilesetId: TILESET.id, tileId: 64 })).toThrow(/outside/);
  });

  it("a rejected op changes nothing (validation happens before writes)", () => {
    const { store, ground, cell } = makeStore(10, 10, 2);
    const before = serializeLevel(store.document);
    expect(() =>
      store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: cell(1) }, { x: 1, y: 0, cell: makeCell(9) }] }),
    ).toThrow();
    expect(serializeLevel(store.document)).toBe(before);
  });

  it("palette deduplicates and is append-only", () => {
    const store = new MapStore(createDocument({ width: 4, height: 4 }));
    store.dispatch({ type: "addTileset", tileset: TILESET });
    const events = record(store);
    expect(store.getOrAddPaletteIndex("grass", 5)).toBe(1);
    expect(store.getOrAddPaletteIndex("grass", 9)).toBe(2);
    expect(store.getOrAddPaletteIndex("grass", 5)).toBe(1);
    expect(store.document.palette.size).toBe(2);
    expect(store.document.palette.get(2)).toEqual({ tilesetId: "grass", tileId: 9 });
    expect(store.document.palette.get(0)).toBeUndefined();
    expect(events.map((e) => e.structure)).toEqual([["palette"], ["palette"]]);
  });

  it("addLayer generates ids, inserts at index and emits a structure event", () => {
    const store = new MapStore(createDocument({ width: 4, height: 4 }));
    const events = record(store);
    const a = store.dispatch({ type: "addLayer", layer: { name: "A" } });
    const b = store.dispatch({ type: "addLayer", layer: { name: "B" }, index: 0 });
    expect([a, b]).toEqual(["layer-1", "layer-2"]);
    expect(store.document.layers.map((l) => l.id)).toEqual(["layer-2", "layer-1"]);
    expect(store.document.layers[0]).toMatchObject({ type: "tile", visible: true, locked: false, opacity: 1 });
    expect(events.every((e) => e.structure[0] === "layers")).toBe(true);
    expect(store.revision).toBe(2);
  });

  it("locked layers are not painted", () => {
    const { store, cell } = makeStore();
    const locked = store.dispatch({ type: "addLayer", layer: { name: "L", locked: true } });
    const patch = store.dispatch({ type: "paintCells", layerId: locked, cells: [{ x: 0, y: 0, cell: cell(1) }] });
    expect(patch.cells).toEqual([]);
  });
});

describe("change events", () => {
  it("reports dirty chunk keys per layer and bumps the revision", () => {
    const { store, ground, cell } = makeStore();
    const events = record(store);
    const rev = store.revision;
    store.dispatch({
      type: "paintCells",
      layerId: ground,
      cells: [{ x: 0, y: 0, cell: cell(1) }, { x: 31, y: 31, cell: cell(1) }, { x: 32, y: 0, cell: cell(1) }, { x: 70, y: 65, cell: cell(1) }],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      revision: rev + 1,
      cause: "dispatch",
      cells: [{ layerId: ground, chunks: ["0,0", "1,0", "2,2"] }],
      structure: [],
      historyChanged: true,
    });
    expect(store.revision).toBe(rev + 1);
  });

  it("emits nothing for a no-op paint", () => {
    const { store, ground } = makeStore();
    const events = record(store);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: 0 }] });
    expect(events).toEqual([]);
  });

  it("unsubscribe stops delivery", () => {
    const { store, ground, cell } = makeStore();
    const events: StoreChangeEvent[] = [];
    const off = store.subscribe((e) => events.push(e));
    off();
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: cell(1) }] });
    expect(events).toEqual([]);
  });

  it("undo reports the chunks it touched", () => {
    const { store, ground, cell } = makeStore();
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 40, y: 40, cell: cell(1) }] });
    const events = record(store);
    store.undo();
    expect(events[0]).toMatchObject({ cause: "undo", cells: [{ layerId: ground, chunks: ["1,1"] }], historyChanged: true });
    expect(store.document.getLayer(ground)?.getChunk(1, 1)).toBeUndefined();
  });
});

describe("transactions", () => {
  it("merges a stroke into one undo step: first before, last after, no-ops dropped", () => {
    const { store, ground, cell } = makeStore();
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 5, y: 5, cell: cell(3) }] });
    const startDepth = store.undoDepth;

    store.beginTransaction();
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 1, y: 1, cell: cell(1) }] });
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 1, y: 1, cell: cell(2) }, { x: 2, y: 1, cell: cell(1) }] });
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 2, y: 1, cell: 0 }] }); // back to original → no-op
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 5, y: 5, cell: cell(4) }] });
    expect(store.canUndo).toBe(false);
    store.commit();

    expect(store.undoDepth).toBe(startDepth + 1);
    store.undo();
    const layer = store.document.getLayer(ground)!;
    expect(layer.getCell(1, 1)).toBe(0);
    expect(layer.getCell(5, 5)).toBe(cell(3));
    store.redo();
    expect(layer.getCell(1, 1)).toBe(cell(2));
    expect(layer.getCell(2, 1)).toBe(0);
    expect(layer.getCell(5, 5)).toBe(cell(4));
  });

  it("a transaction that changes nothing creates no undo step", () => {
    const { store, ground, cell } = makeStore();
    store.beginTransaction();
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 1, y: 1, cell: cell(1) }] });
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 1, y: 1, cell: 0 }] });
    store.commit();
    expect(store.canUndo).toBe(false);
  });

  it("nests; only the outermost commit makes a step", () => {
    const { store, ground, top, cell } = makeStore();
    store.beginTransaction();
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 1, y: 1, cell: cell(1) }] });
    store.beginTransaction();
    store.dispatch({ type: "paintCells", layerId: top, cells: [{ x: 1, y: 1, cell: cell(2) }] });
    store.commit();
    expect(store.inTransaction).toBe(true);
    store.commit();
    expect(store.undoDepth).toBe(1);
    store.undo();
    expect(store.document.getLayer(ground)!.getCell(1, 1)).toBe(0);
    expect(store.document.getLayer(top)!.getCell(1, 1)).toBe(0);
  });

  it("rollback restores the state before the transaction", () => {
    const { store, ground, cell } = makeStore();
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 3, y: 3, cell: cell(5) }] });
    const before = serializeLevel(store.document);
    store.beginTransaction();
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 3, y: 3, cell: cell(1) }, { x: 50, y: 50, cell: cell(2) }] });
    store.rollback();
    expect(serializeLevel(store.document)).toBe(before);
    expect(store.inTransaction).toBe(false);
    expect(store.undoDepth).toBe(1);
  });

  it("commit/rollback without a transaction throw; undo is refused mid-transaction", () => {
    const { store, ground, cell } = makeStore();
    expect(() => store.commit()).toThrow();
    expect(() => store.rollback()).toThrow();
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: cell(1) }] });
    store.beginTransaction();
    expect(store.undo()).toBe(false);
    store.commit();
    expect(store.undo()).toBe(true);
  });

  it("a new step clears the redo stack", () => {
    const { store, ground, cell } = makeStore();
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: cell(1) }] });
    store.undo();
    expect(store.canRedo).toBe(true);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 1, y: 0, cell: cell(1) }] });
    expect(store.canRedo).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it("respects historyLimit", () => {
    const store = new MapStore(createDocument({ width: 8, height: 8 }), { historyLimit: 3 });
    store.dispatch({ type: "addTileset", tileset: TILESET });
    const idx = store.getOrAddPaletteIndex("grass", 0);
    const layer = store.dispatch({ type: "addLayer", layer: { name: "L" } });
    for (let x = 0; x < 5; x++) store.dispatch({ type: "paintCells", layerId: layer, cells: [{ x, y: 0, cell: makeCell(idx) }] });
    expect(store.undoDepth).toBe(3);
  });
});

describe("undo/redo properties", () => {
  const W = 70;
  const H = 70;
  const write = fc.record({
    x: fc.integer({ min: -2, max: W + 1 }),
    y: fc.integer({ min: -2, max: H + 1 }),
    cell: fc.oneof(
      fc.constant(0),
      fc.tuple(fc.integer({ min: 1, max: 6 }), fc.constantFrom(0, FLIP_H)).map(([i, f]) => makeCell(i, f)),
    ),
  });
  const stroke = fc.record({
    layer: fc.constantFrom("ground", "top"),
    ops: fc.array(fc.array(write, { minLength: 1, maxLength: 8 }), { minLength: 1, maxLength: 5 }),
  });

  function setup() {
    const { store } = makeStore(W, H);
    return store;
  }

  it("undoing everything returns to the identical serialized state, redoing everything too", () => {
    fc.assert(
      fc.property(fc.array(stroke, { maxLength: 15 }), (strokes) => {
        const store = setup();
        const initial = serializeLevel(store.document);
        for (const s of strokes) {
          store.beginTransaction();
          for (const cells of s.ops) store.dispatch({ type: "paintCells", layerId: s.layer, cells });
          store.commit();
        }
        const final = serializeLevel(store.document);
        while (store.undo());
        expect(serializeLevel(store.document)).toBe(initial);
        for (const layer of store.document.layers) expect(layer.chunkCount).toBe(0);
        while (store.redo());
        expect(serializeLevel(store.document)).toBe(final);
      }),
    );
  });

  it("random interleavings of strokes, undo and redo match a snapshot model", () => {
    const action = fc.oneof(
      { weight: 3, arbitrary: stroke.map((s) => ({ kind: "stroke" as const, s })) },
      { weight: 1, arbitrary: fc.constant({ kind: "undo" as const }) },
      { weight: 1, arbitrary: fc.constant({ kind: "redo" as const }) },
    );
    fc.assert(
      fc.property(fc.array(action, { maxLength: 30 }), (actions) => {
        const store = setup();
        // Model: list of states; pointer into it.
        const states = [serializeLevel(store.document)];
        let at = 0;
        for (const a of actions) {
          if (a.kind === "stroke") {
            store.beginTransaction();
            for (const cells of a.s.ops) store.dispatch({ type: "paintCells", layerId: a.s.layer, cells });
            store.commit();
            const now = serializeLevel(store.document);
            if (now !== states[at]) {
              states.splice(at + 1, Infinity, now);
              at++;
            }
          } else if (a.kind === "undo") {
            expect(store.undo()).toBe(at > 0);
            if (at > 0) at--;
          } else {
            expect(store.redo()).toBe(at < states.length - 1);
            if (at < states.length - 1) at++;
          }
          expect(serializeLevel(store.document)).toBe(states[at]);
        }
      }),
    );
  });
});
