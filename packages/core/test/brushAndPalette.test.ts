import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  brushFootprint,
  cellPaletteIndex,
  clipFromTileset,
  constrainRect,
  createDocument,
  lineCells,
  makeCell,
  MapStore,
  pasteClip,
  squareCorner,
  strokeCells,
  tilesetCellsInRect,
  type CellPoint,
  type TileClip,
} from "../src";
import { TILESET } from "./helpers";

/** Footprint as an ASCII picture (rows top to bottom; `#` covered, `.` not, `o` the cursor when uncovered). */
function picture(points: readonly CellPoint[]): string[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs, 0);
  const y0 = Math.min(...ys, 0);
  const x1 = Math.max(...xs, 0);
  const y1 = Math.max(...ys, 0);
  const set = new Set(points.map((p) => `${p.x},${p.y}`));
  const rows: string[] = [];
  for (let y = y0; y <= y1; y++) {
    let row = "";
    for (let x = x0; x <= x1; x++) row += set.has(`${x},${y}`) ? "#" : ".";
    rows.push(row);
  }
  return rows;
}

/** Tile ids of a clip, row-major (`null` = empty). */
function clipIds(clip: TileClip): (number | null)[][] {
  const out: (number | null)[][] = [];
  for (let y = 0; y < clip.height; y++) {
    const row: (number | null)[] = [];
    for (let x = 0; x < clip.width; x++) {
      const cell = clip.layers[0]!.cells[y * clip.width + x]!;
      row.push(cell === 0 ? null : clip.palette[cellPaletteIndex(cell) - 1]!.tileId);
    }
    out.push(row);
  }
  return out;
}

describe("brushFootprint", () => {
  it("odd sizes centre on the cursor, even sizes extend toward the top-left", () => {
    expect(brushFootprint(1)).toEqual([{ x: 0, y: 0 }]);
    expect(brushFootprint(2)).toEqual([{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 0 }]);
    const three = brushFootprint(3);
    expect(three).toHaveLength(9);
    expect(Math.min(...three.map((p) => p.x))).toBe(-1);
    expect(Math.max(...three.map((p) => p.x))).toBe(1);
    const four = brushFootprint(4, "square");
    expect([Math.min(...four.map((p) => p.x)), Math.max(...four.map((p) => p.x))]).toEqual([-2, 1]);
  });

  it("circles", () => {
    expect(brushFootprint(1, "circle")).toEqual([{ x: 0, y: 0 }]);
    expect(brushFootprint(2, "circle")).toHaveLength(4);
    expect(picture(brushFootprint(3, "circle"))).toEqual([".#.", "###", ".#."]);
    expect(picture(brushFootprint(4, "circle"))).toEqual([".##.", "####", "####", ".##."]);
    expect(picture(brushFootprint(5, "circle"))).toEqual([".###.", "#####", "#####", "#####", ".###."]);
  });

  it("clamps the size and is symmetric for odd circles (property)", () => {
    expect(brushFootprint(0)).toHaveLength(1);
    expect(brushFootprint(Number.NaN)).toHaveLength(1);
    expect(brushFootprint(1000)).toHaveLength(64 * 64);
    expect(brushFootprint(2.9)).toHaveLength(4);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.constantFrom("square" as const, "circle" as const), (n, shape) => {
        const fp = brushFootprint(n, shape);
        const keys = new Set(fp.map((p) => `${p.x},${p.y}`));
        expect(keys.size).toBe(fp.length);
        expect(keys.has("0,0")).toBe(true);
        // Plain checks per cell, one assertion at the end: thousands of
        // `expect` calls per run made this property time out under load.
        const lo = -Math.floor(n / 2);
        const bad = fp.filter(
          (p) =>
            p.x < lo ||
            p.x >= lo + n ||
            (n % 2 === 1 && !keys.has(`${-p.x},${-p.y}`)) ||
            !keys.has(`${p.y},${p.x}`),
        );
        expect(bad).toEqual([]);
        if (shape === "square") expect(fp).toHaveLength(n * n);
      }),
    );
  });
});

describe("strokeCells", () => {
  it("covers the footprint along the points, deduplicated and clipped", () => {
    const cells = strokeCells(lineCells(0, 0, 3, 0), brushFootprint(2), { width: 10, height: 10 });
    // y = -1 and x = -1 are outside the map.
    expect(cells).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
    const free = strokeCells([{ x: 5, y: 5 }, { x: 6, y: 5 }], brushFootprint(3));
    expect(free).toHaveLength(12);
    expect(new Set(free.map((p) => `${p.x},${p.y}`)).size).toBe(12);
    expect(strokeCells([], brushFootprint(3))).toEqual([]);
  });
});

describe("squareCorner / constrainRect", () => {
  it("Shift makes the rectangle square in the drag direction", () => {
    expect(squareCorner({ x: 2, y: 2 }, { x: 5, y: 3 })).toEqual({ x: 5, y: 5 });
    expect(squareCorner({ x: 2, y: 2 }, { x: 0, y: 7 })).toEqual({ x: -3, y: 7 });
    expect(squareCorner({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual({ x: 2, y: 2 });
    expect(constrainRect({ x: 2, y: 2 }, { x: 5, y: 3 }, true)).toEqual({ x: 2, y: 2, width: 4, height: 4 });
    expect(constrainRect({ x: 2, y: 2 }, { x: 5, y: 3 }, false)).toEqual({ x: 2, y: 2, width: 4, height: 2 });
    expect(constrainRect({ x: 2, y: 2 }, { x: 0, y: -1 }, true)).toEqual({ x: -1, y: -1, width: 4, height: 4 });
    expect(constrainRect({ x: 2, y: 2 }, { x: 0, y: -1 }, true, { width: 10, height: 10 })).toEqual({ x: 0, y: 0, width: 3, height: 3 });
    expect(constrainRect({ x: 20, y: 20 }, { x: 25, y: 21 }, true, { width: 10, height: 10 })).toBeNull();
  });
});

describe("tilesetCellsInRect / clipFromTileset", () => {
  it("tilesetCellsInRect is row-major, any corner order, clamped to the grid", () => {
    expect(tilesetCellsInRect(TILESET, { col: 2, row: 1 }, { col: 1, row: 0 })).toEqual([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ]);
    expect(tilesetCellsInRect(TILESET, { col: 7, row: 7 }, { col: 9, row: 12 })).toEqual([{ col: 7, row: 7 }]);
    expect(tilesetCellsInRect(TILESET, { col: 9, row: 0 }, { col: 12, row: 1 })).toEqual([]);
  });

  it("a rectangle keeps its layout; arbitrary cells leave holes; skipTileIds stay empty", () => {
    const rect = clipFromTileset(TILESET, { x: 1, y: 2, w: 3, h: 2 })!;
    expect(rect).toMatchObject({ width: 3, height: 2 });
    expect(clipIds(rect)).toEqual([
      [17, 18, 19],
      [25, 26, 27],
    ]);
    expect(rect.layers[0]).toMatchObject({ layerId: "tiles", name: "Grass" });
    expect(rect.palette.every((e) => e.tilesetId === "grass")).toBe(true);

    const holes = clipFromTileset(TILESET, [{ col: 5, row: 1 }, { col: 3, row: 3 }, { col: 5, row: 3 }, { col: 5, row: 1 }], "ground")!;
    expect(clipIds(holes)).toEqual([
      [null, null, 13],
      [null, null, null],
      [27, null, 29],
    ]);
    expect(holes.layers[0]!.layerId).toBe("ground");

    const skipped = clipFromTileset(TILESET, { x: 0, y: 0, w: 3, h: 1 }, { skipTileIds: new Set([0]) })!;
    // Skipped tiles at the edge shrink the clip.
    expect(clipIds(skipped)).toEqual([[1, 2]]);
    const middle = clipFromTileset(TILESET, { x: 0, y: 0, w: 3, h: 1 }, { skipTileIds: [1] })!;
    expect(clipIds(middle)).toEqual([[0, null, 2]]);
  });

  it("nothing selectable → null; outside cells are ignored", () => {
    expect(clipFromTileset(TILESET, [])).toBeNull();
    expect(clipFromTileset(TILESET, [{ col: 8, row: 0 }, { col: -1, row: 0 }])).toBeNull();
    expect(clipFromTileset(TILESET, { x: 0, y: 0, w: 1, h: 1 }, { skipTileIds: [0] })).toBeNull();
    expect(clipIds(clipFromTileset(TILESET, { x: 7, y: 7, w: 3, h: 3 })!)).toEqual([[63]]);
  });

  it("pastes into a document as a multi-tile stamp", () => {
    const store = new MapStore(createDocument({ width: 10, height: 10, tilesets: [TILESET] }));
    store.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
    store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ x: 4, y: 3, cell: makeCell(store.getOrAddPaletteIndex("grass", 63)) }] });
    const clip = clipFromTileset(TILESET, [{ col: 0, row: 0 }, { col: 1, row: 1 }])!;
    pasteClip(store, clip, { tiles: "ground" }, 3, 3);
    const layer = store.document.getLayer("ground")!;
    const tile = (x: number, y: number) => {
      const cell = layer.getCell(x, y);
      return cell === 0 ? null : store.document.palette.get(cellPaletteIndex(cell))!.tileId;
    };
    expect([tile(3, 3), tile(4, 3), tile(3, 4), tile(4, 4)]).toEqual([0, 63, null, 9]);
  });
});
