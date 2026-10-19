import { cellFlags, cellPaletteIndex, FLIP_H } from "@smap/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  appendItems,
  clearSlots,
  dropOnPalette,
  itemsOfSlots,
  itemsOfTiles,
  paletteClip,
  paletteRows,
  placeItems,
  setPaletteColumns,
  slotAt,
  slotIndex,
  uniquePaletteName,
  type PaletteData,
} from "./paletteModel";

const empty = (id: string, columns = 4): PaletteData => ({ id, name: id, columns, cells: [] });

describe("palette model", () => {
  it("items of a tileset selection keep their layout and skip transparent tiles", () => {
    // 8-column tileset; ids 1,2,9,10 = a 2×2 block at col 1, row 0.
    const items = itemsOfTiles("ts", 8, [1, 2, 9, 10], new Set([10]));
    expect(items).toEqual([
      { dx: 0, dy: 0, tilesetId: "ts", tileId: 1 },
      { dx: 1, dy: 0, tilesetId: "ts", tileId: 2 },
      { dx: 0, dy: 1, tilesetId: "ts", tileId: 9 },
    ]);
    // A single transparent tile is still carried (the user picked it).
    expect(itemsOfTiles("ts", 8, [10], new Set([10]))).toHaveLength(1);
  });

  it("drop refuses a rectangle that exceeds the last column without losing references", () => {
    const p = placeItems(empty("p"), [{ dx: 0, dy: 0, tilesetId: "ts", tileId: 7 }], 3, 0);
    const items = itemsOfTiles("ts", 8, [1, 2]);
    expect(() => dropOnPalette([p], "p", items, { x: 3, y: 0 }, { kind: "tileset", tilesetId: "ts" }, false)).toThrow();
    expect(p.cells).toEqual([{ x: 3, y: 0, tilesetId: "ts", tileId: 7 }]);
  });

  it("copy between palettes leaves the source; Shift = move empties it", () => {
    const a = placeItems(empty("a"), itemsOfTiles("ts", 8, [1, 2]), 0, 0);
    const b = empty("b");
    const ids = [slotIndex(4, 0, 0), slotIndex(4, 1, 0)];
    const items = itemsOfSlots(a, ids);
    const copy = dropOnPalette([a, b], "b", items, { x: 1, y: 1 }, { kind: "palette", paletteId: "a", ids }, false);
    expect(copy).toHaveLength(1);
    expect(copy[0]!.id).toBe("b");
    expect(copy[0]!.cells.map((c) => [c.x, c.y, c.tileId])).toEqual([
      [1, 1, 1],
      [2, 1, 2],
    ]);
    const move = dropOnPalette([a, b], "b", items, { x: 0, y: 0 }, { kind: "palette", paletteId: "a", ids }, true);
    expect(move.map((p) => p.id)).toEqual(["a", "b"]);
    expect(move[0]!.cells).toEqual([]);
  });

  it("move inside one palette is one change and frees the old slots", () => {
    const a = placeItems(empty("a"), itemsOfTiles("ts", 8, [1]), 0, 0);
    const ids = [0];
    const [next, ...rest] = dropOnPalette([a], "a", itemsOfSlots(a, ids), { x: 2, y: 1 }, { kind: "palette", paletteId: "a", ids }, true);
    expect(rest).toEqual([]);
    expect(next!.cells).toEqual([{ x: 2, y: 1, tilesetId: "ts", tileId: 1 }]);
    // Dropping onto itself without a change reports nothing.
    expect(dropOnPalette([a], "a", itemsOfSlots(a, ids), { x: 0, y: 0 }, { kind: "palette", paletteId: "a", ids }, false)).toEqual([]);
  });

  it("append preserves a reference rectangle and refuses a palette that is too narrow", () => {
    const p = placeItems(empty("p", 3), [{ dx: 0, dy: 0, tilesetId: "ts", tileId: 9 }], 0, 0);
    const next = appendItems(p, itemsOfTiles("ts", 8, [1, 2, 3]));
    expect(next.cells.map(c => [c.x, c.y, c.tileId])).toEqual([[0, 0, 9], [0, 1, 1], [1, 1, 2], [2, 1, 3]]);
    expect(() => appendItems(empty("small", 2), itemsOfTiles("ts", 8, [1, 2, 3]))).toThrow();
  });

  it("clear, rows, and stable sort order", () => {
    const p = placeItems(empty("p"), itemsOfTiles("ts", 8, [0, 8, 16]), 1, 0);
    expect(paletteRows(p)).toBe(3);
    expect(paletteRows(empty("x"))).toBe(2);
    const cleared = clearSlots(p, [slotIndex(4, 1, 1)]);
    expect(cleared.cells.map((c) => c.y)).toEqual([0, 2]);
    expect(slotAt(cleared, 1, 1)).toBeUndefined();
    expect(clearSlots(p, [99])).toBe(p);
  });

  it("selection → stamp keeps layout, holes empty, flags kept", () => {
    const p = placeItems(
      empty("p"),
      [
        { dx: 0, dy: 0, tilesetId: "a", tileId: 3 },
        { dx: 2, dy: 1, tilesetId: "b", tileId: 4, flags: FLIP_H },
      ],
      0,
      0,
    );
    const clip = paletteClip(p, [0, 1, 2, 4, 5, 6], "L")!;
    expect(clip.width).toBe(3);
    expect(clip.height).toBe(2);
    expect(clip.palette).toEqual([
      { tilesetId: "a", tileId: 3 },
      { tilesetId: "b", tileId: 4 },
    ]);
    const cells = clip.layers[0]!.cells;
    expect(clip.layers[0]!.layerId).toBe("L");
    expect(cellPaletteIndex(cells[0]!)).toBe(1);
    expect(cells[1]).toBe(0);
    expect(cellPaletteIndex(cells[5]!)).toBe(2);
    expect(cellFlags(cells[5]!)).toBe(FLIP_H);
    expect(paletteClip(p, [1])).toBeNull();
    expect(paletteClip(p, [0], "tiles", (id) => id !== "a")).toBeNull();
  });

  it("columns reflow by reading order and round-trip", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { maxLength: 12 }), fc.integer({ min: 1, max: 9 }), (indices, cols) => {
        const p: PaletteData = {
          id: "p",
          name: "p",
          columns: 8,
          cells: [...indices].sort((x, y) => x - y).map((i) => ({ x: i % 8, y: Math.floor(i / 8), tilesetId: "ts", tileId: i })),
        };
        const back = setPaletteColumns(setPaletteColumns(p, cols), 8);
        expect(back.cells).toEqual(p.cells);
        expect(back.columns).toBe(p.columns);
        expect(paletteRows(back)).toBeGreaterThanOrEqual(paletteRows(p));
      }),
    );
  });

  it("unique names", () => {
    expect(uniquePaletteName([], "Palet")).toBe("Palet");
    expect(uniquePaletteName([{ name: "Palet" }, { name: "palet 2" }], "Palet")).toBe("Palet 3");
  });
});
