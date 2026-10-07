import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FLIP_H,
  FLIP_V,
  copyRegion,
  createDocument,
  cutRegion,
  flipClip,
  floodFill,
  makeCell,
  MapStore,
  parseLevel,
  pasteClip,
  rectCells,
  serializeLevel,
  type StoreChangeEvent,
} from "../src";
import { TILESET, makeStore } from "./helpers";

describe("undo grouping", () => {
  it("one transaction mixing every kind of change is one undo step", () => {
    const { store, ground, top, cell } = makeStore(30, 30);
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 29, y: 29, cell: cell(1) }] });
    const before = serializeLevel(store.document);
    const depth = store.undoDepth;
    const events: StoreChangeEvent[] = [];
    store.subscribe((e) => events.push(e));

    store.beginTransaction();
    store.dispatch({ type: "paintCells", layerId: ground, cells: rectCells(0, 0, 3, 3).map((p) => ({ ...p, cell: cell(2) })) });
    const added = store.dispatch({ type: "addLayer", layer: { name: "New" }, index: 0 });
    store.dispatch({ type: "paintCells", layerId: added, cells: [{ x: 1, y: 1, cell: cell(3) }] });
    store.dispatch({ type: "setLayerProps", layerId: top, props: { opacity: 0.5, name: "T" } });
    store.dispatch({ type: "moveLayer", layerId: top, index: 0 });
    store.dispatch({ type: "resizeMap", width: 20, height: 25, offsetX: -2, offsetY: 1 });
    const fill = floodFill(store.document.getLayer(ground)!, 10, 10, cell(4), store.document.map);
    store.dispatch({ type: "paintCells", layerId: ground, cells: fill.map((p) => ({ ...p, cell: cell(4) })) });
    const clip = copyRegion(store.document, [ground, added], { x: 0, y: 0, width: 5, height: 5 });
    pasteClip(store, flipClip(clip, "x"), null, 12, 12);
    cutRegion(store, [ground], { x: 0, y: 0, width: 2, height: 2 });
    store.dispatch({ type: "removeLayer", layerId: added });
    expect(store.undoDepth).toBe(depth);
    store.commit();
    const after = serializeLevel(store.document);

    expect(store.undoDepth).toBe(depth + 1);
    expect(events.filter((e) => e.historyChanged).map((e) => e.cause)).toEqual(["begin", "commit"]);
    expect(events.some((e) => e.structure.includes("map"))).toBe(true);
    store.undo();
    expect(serializeLevel(store.document)).toBe(before);
    store.redo();
    expect(serializeLevel(store.document)).toBe(after);
  });

  it("undo/redo events report the union of structure kinds", () => {
    const { store, ground } = makeStore(10, 10);
    store.beginTransaction();
    store.dispatch({ type: "setLayerProps", layerId: ground, props: { visible: false } });
    store.dispatch({ type: "resizeMap", width: 12, height: 12 });
    store.commit();
    const events: StoreChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    store.undo();
    store.redo();
    expect(events.map((e) => [e.cause, e.structure])).toEqual([
      ["undo", ["layers", "map"]],
      ["redo", ["layers", "map"]],
    ]);
  });
});

describe("historyLimit", () => {
  function limited(limit: number) {
    const store = new MapStore(createDocument({ width: 16, height: 16 }), { historyLimit: limit });
    store.dispatch({ type: "addTileset", tileset: TILESET });
    const idx = store.getOrAddPaletteIndex("grass", 0);
    const layer = store.dispatch({ type: "addLayer", layer: { id: "L", name: "L" } });
    store.clearHistory();
    return { store, idx, layer };
  }

  it("trims the oldest steps, keeps the newest, and undo stops at the limit", () => {
    const { store, idx, layer } = limited(3);
    for (let x = 0; x < 6; x++) store.dispatch({ type: "paintCells", layerId: layer, cells: [{ x, y: 0, cell: makeCell(idx) }] });
    expect(store.undoDepth).toBe(3);
    while (store.undo());
    const l = store.document.getLayer(layer)!;
    // Steps for x = 0..2 were trimmed; their cells stay.
    expect([0, 1, 2, 3, 4, 5].map((x) => l.getCell(x, 0) !== 0)).toEqual([true, true, true, false, false, false]);
    expect(store.redoDepth).toBe(3);
    while (store.redo());
    expect(l.chunkCount).toBe(1);
    expect(l.getCell(5, 0)).toBe(makeCell(idx));
  });

  it("counts structural steps and transactions as single steps", () => {
    const { store, idx, layer } = limited(2);
    store.dispatch({ type: "addLayer", layer: { id: "A", name: "A" } });
    store.beginTransaction();
    store.dispatch({ type: "paintCells", layerId: layer, cells: [{ x: 0, y: 0, cell: makeCell(idx) }] });
    store.dispatch({ type: "removeLayer", layerId: "A" });
    store.commit();
    store.dispatch({ type: "resizeMap", width: 8, height: 8 });
    expect(store.undoDepth).toBe(2);
    store.undo();
    store.undo();
    expect(store.canUndo).toBe(false);
    expect(store.document.layers.map((l) => l.id)).toEqual(["L", "A"]); // addLayer step was trimmed
    expect(store.document.map.width).toBe(16);
  });

  it("historyLimit 0 keeps no steps", () => {
    const { store, idx, layer } = limited(0);
    store.dispatch({ type: "paintCells", layerId: layer, cells: [{ x: 0, y: 0, cell: makeCell(idx) }] });
    expect(store.canUndo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CLAUDE.md v0.2 "Bitti": a random op sequence, fully undone, gives back the
// starting map byte for byte.

const W0 = 14;
const H0 = 12;
const PALETTE = 5;
const coord = fc.integer({ min: -2, max: 22 });
const cellArb = fc.oneof(
  { weight: 1, arbitrary: fc.constant(0) },
  {
    weight: 4,
    arbitrary: fc
      .tuple(fc.integer({ min: 1, max: PALETTE }), fc.constantFrom(0, FLIP_H, FLIP_V, FLIP_H | FLIP_V))
      .map(([i, f]) => makeCell(i, f)),
  },
);
const pick = fc.nat({ max: 7 });

const actionArb = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("stroke" as const),
      layer: pick,
      dabs: fc.array(fc.array(fc.record({ x: coord, y: coord, cell: cellArb }), { minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 4 }),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("fill" as const), layer: pick, x: coord, y: coord, cell: cellArb }) },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant("rect" as const), layer: pick, x0: coord, y0: coord, x1: coord, y1: coord, cell: cellArb }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("paste" as const),
      layers: fc.array(pick, { minLength: 1, maxLength: 3 }),
      x: coord, y: coord, w: fc.integer({ min: 1, max: 6 }), h: fc.integer({ min: 1, max: 6 }),
      tx: coord, ty: coord,
      flip: fc.constantFrom(null, "x" as const, "y" as const),
      erase: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("cut" as const),
      layers: fc.array(pick, { minLength: 1, maxLength: 3 }),
      x: coord, y: coord, w: fc.integer({ min: 1, max: 6 }), h: fc.integer({ min: 1, max: 6 }),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("addLayer" as const), index: pick }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("removeLayer" as const), layer: pick }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("moveLayer" as const), layer: pick, index: pick }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("props" as const),
      layer: pick,
      props: fc.record(
        { name: fc.constantFrom("a", "b", "Zemin"), visible: fc.boolean(), locked: fc.boolean(), opacity: fc.constantFrom(0, 0.25, 1) },
        { requiredKeys: [] },
      ),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("resize" as const),
      width: fc.integer({ min: 1, max: 22 }),
      height: fc.integer({ min: 1, max: 22 }),
      offsetX: fc.oneof(fc.constant(0), fc.integer({ min: -6, max: 6 })),
      offsetY: fc.oneof(fc.constant(0), fc.integer({ min: -6, max: 6 })),
    }),
  },
  { weight: 2, arbitrary: fc.constant({ kind: "undo" as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: "redo" as const }) },
);
type Action = typeof actionArb extends fc.Arbitrary<infer A> ? A : never;
type EditAction = Exclude<Action, { kind: "undo" } | { kind: "redo" }>;
const editArb = actionArb.filter((a): a is EditAction => a.kind !== "undo" && a.kind !== "redo");
const stepArb = fc.oneof(
  { weight: 6, arbitrary: actionArb.map((a) => [a]) },
  // several edits grouped into one transaction (one undo step)
  { weight: 1, arbitrary: fc.array(editArb, { minLength: 2, maxLength: 4 }).map((group) => group as Action[]) },
);

function setup(): MapStore {
  const { store } = makeStore(W0, H0, PALETTE);
  store.dispatch({ type: "setLayerProps", layerId: "top", props: { opacity: 0.5 } });
  store.dispatch({ type: "paintCells", layerId: "ground", cells: rectCells(2, 2, 6, 5).map((p) => ({ ...p, cell: makeCell(1) })) });
  store.dispatch({ type: "paintCells", layerId: "top", cells: [{ x: 13, y: 11, cell: makeCell(3, FLIP_H) }] });
  store.clearHistory();
  return store;
}

function layerAt(store: MapStore, n: number): string | undefined {
  const layers = store.document.layers;
  return layers.length === 0 ? undefined : layers[n % layers.length]!.id;
}

function layerSet(store: MapStore, picks: readonly number[]): string[] {
  return [...new Set(picks.map((p) => layerAt(store, p)).filter((id): id is string => id !== undefined))];
}

function applyEdit(store: MapStore, a: EditAction): void {
  const doc = store.document;
  switch (a.kind) {
    case "stroke": {
      const layerId = layerAt(store, a.layer);
      if (!layerId) return;
      store.beginTransaction();
      for (const cells of a.dabs) store.dispatch({ type: "paintCells", layerId, cells });
      store.commit();
      return;
    }
    case "fill": {
      const layerId = layerAt(store, a.layer);
      if (!layerId) return;
      const points = floodFill(doc.getLayer(layerId)!, a.x, a.y, a.cell, doc.map);
      store.dispatch({ type: "paintCells", layerId, cells: points.map((p) => ({ ...p, cell: a.cell })) });
      return;
    }
    case "rect": {
      const layerId = layerAt(store, a.layer);
      if (!layerId) return;
      const cells = rectCells(a.x0, a.y0, a.x1, a.y1, doc.map).map((p) => ({ ...p, cell: a.cell }));
      store.dispatch({ type: "paintCells", layerId, cells });
      return;
    }
    case "paste": {
      const ids = layerSet(store, a.layers);
      if (ids.length === 0) return;
      let clip = copyRegion(doc, ids, { x: a.x, y: a.y, width: a.w, height: a.h });
      if (a.flip) clip = flipClip(clip, a.flip);
      pasteClip(store, clip, null, a.tx, a.ty, { emptyCells: a.erase ? "erase" : "skip" });
      return;
    }
    case "cut": {
      const ids = layerSet(store, a.layers);
      if (ids.length === 0) return;
      cutRegion(store, ids, { x: a.x, y: a.y, width: a.w, height: a.h });
      return;
    }
    case "addLayer":
      store.dispatch({ type: "addLayer", layer: { name: "L" }, index: a.index % (doc.layers.length + 1) });
      return;
    case "removeLayer": {
      const layerId = layerAt(store, a.layer);
      if (layerId) store.dispatch({ type: "removeLayer", layerId });
      return;
    }
    case "moveLayer": {
      const layerId = layerAt(store, a.layer);
      if (layerId) store.dispatch({ type: "moveLayer", layerId, index: a.index % doc.layers.length });
      return;
    }
    case "props": {
      const layerId = layerAt(store, a.layer);
      if (layerId) store.dispatch({ type: "setLayerProps", layerId, props: a.props });
      return;
    }
    case "resize":
      store.dispatch({ type: "resizeMap", width: a.width, height: a.height, offsetX: a.offsetX, offsetY: a.offsetY });
      return;
  }
}

describe("v0.2 Bitti: random op sequences are fully reversible", () => {
  it("undo all → initial bytes, redo all → final bytes; every state roundtrips; matches a snapshot model", () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 60 }).map((steps) => steps.flat().slice(0, 60)), (actions) => {
        const store = setup();
        const initial = serializeLevel(store.document);
        const states = [initial];
        let at = 0;
        let i = 0;
        while (i < actions.length) {
          const a = actions[i]!;
          if (a.kind === "undo") {
            expect(store.undo()).toBe(at > 0);
            if (at > 0) at--;
            i++;
          } else if (a.kind === "redo") {
            expect(store.redo()).toBe(at < states.length - 1);
            if (at < states.length - 1) at++;
            i++;
          } else {
            const depth = store.undoDepth;
            const redo = store.redoDepth;
            const before = serializeLevel(store.document);
            applyEdit(store, a);
            i++;
            const now = serializeLevel(store.document);
            if (store.undoDepth === depth + 1) {
              expect(store.redoDepth).toBe(0);
              states.splice(at + 1, Infinity, now);
              at++;
            } else {
              // No undo step → nothing changed and the redo stack is intact.
              expect(store.undoDepth).toBe(depth);
              expect(store.redoDepth).toBe(redo);
              expect(now).toBe(before);
            }
          }
          const text = serializeLevel(store.document);
          expect(text).toBe(states[at]);
          expect(serializeLevel(parseLevel(text, store.document.tilesets))).toBe(text);
        }

        const final = serializeLevel(store.document);
        while (store.undo());
        expect(serializeLevel(store.document)).toBe(initial);
        while (store.redo());
        expect(serializeLevel(store.document)).toBe(states[states.length - 1]);
        if (at === states.length - 1) expect(serializeLevel(store.document)).toBe(final);
      }),
      { numRuns: 300 },
    );
  });

  it("grouped transactions are single steps in the same model", () => {
    fc.assert(
      fc.property(fc.array(fc.array(editArb, { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 12 }), (groups) => {
        const store = setup();
        const states = [serializeLevel(store.document)];
        for (const group of groups) {
          const depth = store.undoDepth;
          store.beginTransaction();
          for (const a of group) applyEdit(store, a);
          store.commit();
          expect(store.undoDepth - depth).toBeLessThanOrEqual(1);
          if (store.undoDepth > depth) states.push(serializeLevel(store.document));
        }
        for (let s = states.length - 2; s >= 0; s--) {
          expect(store.undo()).toBe(true);
          expect(serializeLevel(store.document)).toBe(states[s]);
        }
        expect(store.undo()).toBe(false);
        for (let s = 1; s < states.length; s++) {
          expect(store.redo()).toBe(true);
          expect(serializeLevel(store.document)).toBe(states[s]);
        }
      }),
      { numRuns: 150 },
    );
  });
});
