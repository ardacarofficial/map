import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FLIP_H,
  FLIP_V,
  FormatError,
  copyRegion,
  cutRegion,
  flipClip,
  hasFlipH,
  hasFlipV,
  makeCell,
  parseClip,
  pasteClip,
  serializeClip,
  serializeLevel,
  type TileClip,
} from "../src";
import { TILESET, makeStore } from "./helpers";

function setupSource() {
  const { store, ground, top } = makeStore(40, 40, 6);
  store.dispatch({
    type: "paintCells",
    layerId: ground,
    cells: [{ x: 2, y: 2, cell: makeCell(5) }, { x: 3, y: 2, cell: makeCell(2, FLIP_H) }, { x: 4, y: 3, cell: makeCell(5, FLIP_V) }],
  });
  store.dispatch({ type: "paintCells", layerId: top, cells: [{ x: 2, y: 3, cell: makeCell(6) }] });
  return { store, ground, top };
}

describe("copyRegion", () => {
  it("builds a compact clip palette in first-use order", () => {
    const { store, ground, top } = setupSource();
    const clip = copyRegion(store.document, [ground, top], { x: 2, y: 2, width: 3, height: 2 });
    expect(clip.width).toBe(3);
    expect(clip.height).toBe(2);
    expect(clip.palette).toEqual([{ tilesetId: "grass", tileId: 4 }, { tilesetId: "grass", tileId: 1 }, { tilesetId: "grass", tileId: 5 }]);
    expect([...clip.layers[0]!.cells]).toEqual([makeCell(1), makeCell(2, FLIP_H), 0, 0, 0, makeCell(1, FLIP_V)]);
    expect([...clip.layers[1]!.cells]).toEqual([0, 0, 0, makeCell(3), 0, 0]);
    expect(clip.layers.map((l) => l.layerId)).toEqual([ground, top]);
    expect(() => copyRegion(store.document, ["nope"], { x: 0, y: 0, width: 1, height: 1 })).toThrow(/unknown layer/);
    expect(() => copyRegion(store.document, [ground], { x: 0, y: 0, width: 0, height: 1 })).toThrow(/rect/);
  });
});

describe("pasteClip", () => {
  it("pastes into a document with a different palette, preserving flips, as one undo step", () => {
    const { store, ground, top } = setupSource();
    const clip = copyRegion(store.document, [ground, top], { x: 2, y: 2, width: 3, height: 2 });

    const target = makeStore(20, 20, 0);
    target.store.getOrAddPaletteIndex(TILESET.id, 1); // index 1 = tile 1 (different from source)
    target.store.clearHistory();
    const before = serializeLevel(target.store.document);
    const patches = pasteClip(target.store, clip, { [ground]: "top", [top]: "ground" }, 10, 10);
    expect(patches.map((p) => p.layerId)).toEqual(["top", "ground"]);
    expect(target.store.undoDepth).toBe(1);
    const doc = target.store.document;
    const t = doc.getLayer("top")!;
    const tileAt = (cell: number) => doc.palette.get(cell & 0x1fff_ffff);
    expect(tileAt(t.getCell(10, 10))).toEqual({ tilesetId: "grass", tileId: 4 });
    expect(hasFlipH(t.getCell(11, 10))).toBe(true);
    expect(tileAt(t.getCell(11, 10))).toEqual({ tilesetId: "grass", tileId: 1 });
    expect(t.getCell(11, 10) & 0x1fff_ffff).toBe(1); // reused existing entry
    expect(hasFlipV(t.getCell(12, 11))).toBe(true);
    expect(tileAt(doc.getLayer("ground")!.getCell(10, 11))).toEqual({ tilesetId: "grass", tileId: 5 });
    target.store.undo();
    // palette entries stay (append-only); cells are back
    const reparsed = JSON.parse(serializeLevel(target.store.document)) as { layers: unknown };
    expect(reparsed.layers).toEqual((JSON.parse(before) as { layers: unknown }).layers);
  });

  it("skips empty clip cells by default, erases them on request", () => {
    const { store, ground } = setupSource();
    const clip = copyRegion(store.document, [ground], { x: 2, y: 2, width: 2, height: 2 });
    const target = makeStore(10, 10, 3);
    target.store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ x: 0, y: 1, cell: makeCell(1) }] });
    pasteClip(target.store, clip, null, 0, 0);
    expect(target.store.document.getLayer("ground")!.getCell(0, 1)).toBe(makeCell(1));
    pasteClip(target.store, clip, null, 0, 0, { emptyCells: "erase" });
    expect(target.store.document.getLayer("ground")!.getCell(0, 1)).toBe(0);
  });

  it("clips at the map edge, skips unmapped layers and validates before writing", () => {
    const { store, ground, top } = setupSource();
    const clip = copyRegion(store.document, [ground, top], { x: 2, y: 2, width: 3, height: 2 });
    const target = makeStore(4, 4, 0);
    const patches = pasteClip(target.store, clip, new Map([[ground, "ground"]]), 3, 3);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.cells).toHaveLength(1);
    expect(target.store.document.getLayer("top")!.chunkCount).toBe(0);
    expect(() => pasteClip(target.store, clip, { [ground]: "missing" }, 0, 0)).toThrow(/unknown target layer/);
    const foreign: TileClip = { ...clip, palette: [{ tilesetId: "other", tileId: 0 }, ...clip.palette.slice(1)] };
    const snapshot = serializeLevel(target.store.document);
    expect(() => pasteClip(target.store, foreign, null, 0, 0)).toThrow(/unknown tileset/);
    expect(serializeLevel(target.store.document)).toBe(snapshot);
    expect(target.store.inTransaction).toBe(false);
  });

  it("nests inside an open transaction", () => {
    const { store, ground } = setupSource();
    const clip = copyRegion(store.document, [ground], { x: 2, y: 2, width: 3, height: 2 });
    const depth = store.undoDepth;
    store.beginTransaction();
    pasteClip(store, clip, null, 20, 20);
    pasteClip(store, clip, null, 30, 30);
    store.commit();
    expect(store.undoDepth).toBe(depth + 1);
  });
});

describe("cutRegion", () => {
  it("copies and clears as one undo step", () => {
    const { store, ground, top } = setupSource();
    const before = serializeLevel(store.document);
    const depth = store.undoDepth;
    const clip = cutRegion(store, [ground, top], { x: 2, y: 2, width: 3, height: 2 });
    expect(store.undoDepth).toBe(depth + 1);
    expect(store.document.getLayer(ground)!.chunkCount).toBe(0);
    expect(store.document.getLayer(top)!.chunkCount).toBe(0);
    pasteClip(store, clip, null, 2, 2);
    expect(serializeLevel(store.document)).toBe(before);
    store.undo();
    store.undo();
    expect(serializeLevel(store.document)).toBe(before);
  });
});

describe("flipClip", () => {
  it("mirrors cells and toggles flags; flipping twice is the identity", () => {
    const { store, ground } = setupSource();
    const clip = copyRegion(store.document, [ground], { x: 2, y: 2, width: 3, height: 2 });
    const fx = flipClip(clip, "x");
    expect([...fx.layers[0]!.cells]).toEqual([0, makeCell(2), makeCell(1, FLIP_H), makeCell(1, FLIP_V | FLIP_H), 0, 0]);
    const fy = flipClip(clip, "y");
    expect([...fy.layers[0]!.cells]).toEqual([0, 0, makeCell(1), makeCell(1, FLIP_V), makeCell(2, FLIP_H | FLIP_V), 0]);
    expect(flipClip(fx, "x")).toEqual(clip);
    expect(flipClip(fy, "y")).toEqual(clip);
  });
});

describe("clip serialization", () => {
  it("roundtrips deterministically for random clips", () => {
    const clipArb = fc
      .record({ w: fc.integer({ min: 1, max: 6 }), h: fc.integer({ min: 1, max: 6 }), p: fc.integer({ min: 0, max: 4 }), layers: fc.integer({ min: 0, max: 3 }) })
      .chain(({ w, h, p, layers }) =>
        fc.record({
          width: fc.constant(w),
          height: fc.constant(h),
          palette: fc.constant(Array.from({ length: p }, (_, i) => ({ tilesetId: i % 2 ? "a" : "b", tileId: i }))),
          layers: fc.array(
            fc.array(fc.tuple(fc.integer({ min: 0, max: p }), fc.constantFrom(0, FLIP_H, FLIP_V, FLIP_H | FLIP_V)), { minLength: w * h, maxLength: w * h }),
            { minLength: layers, maxLength: layers },
          ),
        }),
      )
      .map((c): TileClip => ({
        width: c.width,
        height: c.height,
        palette: c.palette,
        layers: c.layers.map((cells, i) => ({ layerId: `l${i}`, name: `Layer ${i}`, cells: Uint32Array.from(cells, ([idx, f]) => makeCell(idx, f)) })),
      }));
    fc.assert(
      fc.property(clipArb, (clip) => {
        const text = serializeClip(clip);
        const parsed = parseClip(text);
        expect(parsed).toEqual(clip);
        expect(serializeClip(parsed)).toBe(text);
      }),
    );
  });

  it("rejects non-clips and malformed clips", () => {
    const { store, ground } = setupSource();
    const text = serializeClip(copyRegion(store.document, [ground], { x: 2, y: 2, width: 3, height: 2 }));
    expect(() => parseClip("hello")).toThrow(FormatError);
    expect(() => parseClip(serializeLevel(store.document))).toThrow(/not a clip/);
    const bad = (mutate: (c: Record<string, unknown> & { layers: Record<string, unknown>[] }) => void, pattern: RegExp) => {
      const c = JSON.parse(text);
      mutate(c);
      expect(() => parseClip(JSON.stringify(c))).toThrow(pattern);
    };
    bad((c) => (c.width = 0), /size/);
    bad((c) => (c.width = 4), /expected 8 cells/);
    bad((c) => (c.palette = []), /palette index/);
    bad((c) => c.layers.push({ ...c.layers[0]! }), /duplicate layerId/);
  });
});
