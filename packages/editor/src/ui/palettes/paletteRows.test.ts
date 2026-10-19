import { describe, expect, it } from "vitest";
import { appendItems, itemsOfSlots, itemsOfTiles, paletteRows, placeItems, setPaletteColumns, setPaletteRows } from "./paletteModel";

const palette = { id: "p", name: "P", columns: 4, rows: 2, cells: [{ x: 2, y: 1, tilesetId: "t", tileId: 4 }] };
describe("explicit palette rows and reference rectangles", () => {
  it("grows without cells, refuses occupied shrink, and trims only explicitly", () => {
    const grown = setPaletteRows(palette, 6);
    expect(paletteRows(grown)).toBe(6);
    expect(grown.cells).toEqual(palette.cells);
    expect(() => setPaletteRows(palette, 1)).toThrow();
    expect(setPaletteRows(palette, 1, true)).toEqual({ ...palette, rows: 1, cells: [] });
    expect(paletteRows({ cells: palette.cells })).toBe(3);
  });
  it("grows for paste and column reflow and rejects capacity overflow atomically", () => {
    const items = itemsOfTiles("t", 2, [0, 1, 2, 3]);
    expect(placeItems(palette, items, 0, 2).rows).toBe(4);
    expect(setPaletteColumns(palette, 1).rows).toBe(7);
    expect(() => placeItems(palette, items, 0, 255)).toThrow();
    expect(() => placeItems(palette, items, 3, 0)).toThrow();
    expect(() => appendItems({ ...palette, rows: 256, cells: [] }, itemsOfTiles("t", 1, [0, 256]))).toThrow();
  });
  it("keeps leading/trailing holes, flips and cross-tileset references", () => {
    const items = itemsOfSlots({ ...palette, cells: [{ x: 1, y: 0, tilesetId: "other", tileId: 2, flags: 0x80000000 }] }, [0, 1, 2, 4, 5, 6]);
    const pasted = placeItems({ ...palette, rows: 1, cells: [] }, items, 0, 1);
    expect(pasted.rows).toBe(3);
    expect(pasted.cells).toEqual([{ x: 1, y: 1, tilesetId: "other", tileId: 2, flags: 0x80000000 }]);
    const png = itemsOfTiles("t", 3, [0, 1, 2, 3, 4, 5], new Set([0, 2, 3, 4, 5]));
    expect(placeItems({ ...palette, rows: 1, cells: [] }, png, 0, 1).rows).toBe(3);
  });
});
