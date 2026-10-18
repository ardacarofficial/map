import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { connectedSelection, selectionContains, selectionHasContent, combineSelections, transformSelection, copyRegion, cutRegion, moveRegion, rotateRegion, flipRegion, serializeLevel, serializeClip, makeCell, FLIP_H, planTileReplacement, type SelectionRect } from "../src";
import { makeStore } from "./helpers";

const shape: SelectionRect = { x: 2, y: 2, width: 2, height: 2, mask: Uint8Array.of(1, 1, 1, 0) };

describe("connected selection", () => {
  it("selects uniform non-empty chunk-backed layers completely, including flip bits", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 6 }), (width, height, index) => {
      const { store, ground } = makeStore(width, height, 6);
      const cell = makeCell(index, FLIP_H);
      store.dispatch({ type: "paintCells", layerId: ground, cells: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), cell })) });
      const source = store.document.getLayer(ground)!;
      const region = connectedSelection(source, width - 1, height - 1, store.document.map);
      expect(region).toEqual({ x: 0, y: 0, width, height, mask: new Uint8Array(width * height).fill(1) });
      expect(connectedSelection(source, 0, 0, store.document.map)).toEqual(region);
    }));
  });
  it("is exactly the four-connected equal component, including empty cells and flags", () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 64, maxLength: 64 }), fc.integer({ min: 0, max: 63 }), (values, seed) => {
      const getCell = (x: number, y: number) => values[y * 8 + x]!;
      const result = connectedSelection({ getCell }, seed % 8, seed >> 3, { width: 8, height: 8 });
      const seen = new Set<number>([seed]), queue = [seed];
      for (const i of queue) for (const [x, y] of [[i % 8 - 1, i >> 3], [i % 8 + 1, i >> 3], [i % 8, (i >> 3) - 1], [i % 8, (i >> 3) + 1]]) {
        if (x! < 0 || y! < 0 || x! >= 8 || y! >= 8) continue;
        const n = y! * 8 + x!;
        if (!seen.has(n) && values[n] === values[seed]) { seen.add(n); queue.push(n); }
      }
      for (let i = 0; i < 64; i++) expect(selectionContains(result, i % 8, i >> 3)).toBe(seen.has(i));
      expect(connectedSelection({ getCell }, seed % 8, seed >> 3, { width: 8, height: 8 })).toEqual(result);
    }));
    expect(connectedSelection({ getCell: x => x ? makeCell(1, FLIP_H) : makeCell(1) }, 0, 0, { width: 2, height: 1 })?.width).toBe(1);
    expect(connectedSelection({ getCell: () => 0 }, -1, 0, { width: 2, height: 1 })).toBeNull();
  });
  it("adds and subtracts masks and trims empty margins", () => {
    const one = { x: 3, y: 3, width: 1, height: 1 };
    const added = combineSelections(shape, one, "add");
    expect(selectionContains(added, 3, 3)).toBe(true);
    expect(combineSelections(shape, shape, "subtract")).toBeNull();
    expect(selectionContains(combineSelections(added, one, "subtract"), 3, 3)).toBe(false);
  });
  it("combination matches boolean set algebra deterministically", () => {
    fc.assert(fc.property(fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }), fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }), (av, bv) => {
      const a = { x: 2, y: 2, width: 4, height: 3, mask: Uint8Array.from(av, Number) };
      const b = { x: 3, y: 3, width: 4, height: 3, mask: Uint8Array.from(bv, Number) };
      for (const mode of ["add", "subtract"] as const) {
        const result = combineSelections(a, b, mode);
        expect(combineSelections(a, b, mode)).toEqual(result);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const ac = selectionContains(a, x, y), bc = selectionContains(b, x, y);
          expect(selectionContains(result, x, y)).toBe(mode === "add" ? ac || bc : ac && !bc);
        }
      }
    }));
  });
  it("mask transforms compose without losing holes", () => {
    fc.assert(fc.property(fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }), bits => {
      const r = { x: 5, y: 5, width: 4, height: 3, mask: Uint8Array.from(bits, Number) };
      let turned = r;
      for (let i = 0; i < 4; i++) turned = transformSelection(turned, "cw") as typeof r;
      expect(turned).toEqual(r);
      expect(transformSelection(transformSelection(r, "x"), "x")).toEqual(r);
      expect(transformSelection(transformSelection(r, "y"), "y")).toEqual(r);
    }));
  });
});

describe("mask operations", () => {
  for (const action of ["cut", "delete", "move", "cw", "ccw", "x", "y"] as const) it(`${action} keeps holes untouched and round trips undo/redo deterministically`, () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 6 }), { minLength: 64, maxLength: 64 }), fc.integer({ min: -2, max: 4 }), fc.integer({ min: -2, max: 4 }), (values, dx, dy) => {
      const run = () => {
        const { store, ground, top } = makeStore(8, 8, 6);
        const grid = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
        for (const layerId of [ground, top]) store.dispatch({ type: "paintCells", layerId, cells: values.map((v, i) => ({ x: i % 8, y: i >> 3, cell: makeCell(v, i % 2 ? FLIP_H : 0) })) });
        store.dispatch({ type: "paintGrid", layerId: grid, cells: values.map((v, i) => ({ x: i % 8, y: i >> 3, value: v % 3 })) });
        store.clearHistory();
        const before = serializeLevel(store.document);
        const hole = store.document.getLayer(ground)!.getCell(3, 3);
        const clip = copyRegion(store.document, [ground, top, grid], shape);
        expect(clip.layers.every(l => l.cells[3] === 0)).toBe(true);
        for (const id of [ground, top, grid]) expect(selectionHasContent(store.document.getLayer(id)!, shape)).toBe(clip.layers.find(l => l.layerId === id)!.cells.some(c => c !== 0));
        expect(serializeClip(copyRegion(store.document, [ground, top, grid], shape))).toBe(serializeClip(clip));
        if (action === "move") moveRegion(store, [ground, top, grid], shape, dx, dy);
        else if (action === "cw" || action === "ccw") rotateRegion(store, [ground, top, grid], shape, action);
        else if (action === "x" || action === "y") flipRegion(store, [ground, top, grid], shape, action);
        else cutRegion(store, [ground, top, grid], shape);
        if (action === "cut" || action === "delete" || (action === "move" && !selectionContains({ ...shape, x: shape.x + dx, y: shape.y + dy }, 3, 3))) expect(store.document.getLayer(ground)!.getCell(3, 3)).toBe(hole);
        const after = serializeLevel(store.document);
        expect(store.undoDepth).toBe(action === "move" && dx === 0 && dy === 0 ? 0 : 1);
        store.undo(); expect(serializeLevel(store.document)).toBe(before);
        store.redo(); expect(serializeLevel(store.document)).toBe(after);
        return after;
      };
      expect(run()).toBe(run());
    }), { numRuns: 30 });
  });
});

it("replacement plans never include an unselected cell and preserve flags", () => {
  fc.assert(fc.property(fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }), bits => {
    const { store, ground } = makeStore(8, 8, 6);
    store.dispatch({ type: "paintCells", layerId: ground, cells: bits.map((_, i) => ({ x: i % 8, y: i >> 3, cell: makeCell(1, FLIP_H) })) });
    const region = { x: 0, y: 0, width: 8, height: 8, mask: Uint8Array.from(bits, Number) };
    const plans = planTileReplacement(store.document, { from: store.document.palette.get(1)!, to: store.document.palette.get(2)!, layerIds: [ground], region });
    const writes = plans.flatMap(p => p.cells);
    expect(writes).toHaveLength(bits.filter(Boolean).length);
    for (const c of writes) { expect(bits[c.y * 8 + c.x]).toBe(true); expect(c.cell).toBe(makeCell(2, FLIP_H)); }
  }));
});

it("rotation clips membership together with cells at the map edge", () => {
  const { store, ground } = makeStore(6, 6, 6);
  const r = { x: 0, y: 0, width: 1, height: 3, mask: Uint8Array.of(1, 0, 1) };
  store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: 1 }, { x: 0, y: 1, cell: 2 }, { x: 0, y: 2, cell: 3 }] });
  store.clearHistory();
  const before = serializeLevel(store.document);
  const result = rotateRegion(store, [ground], r, "cw");
  expect(result).toEqual({ x: 0, y: 1, width: 2, height: 1, mask: Uint8Array.of(0, 1) });
  expect(store.document.getLayer(ground)!.getCell(0, 1)).toBe(2);
  expect(store.undoDepth).toBe(1); store.undo(); expect(serializeLevel(store.document)).toBe(before);
});
