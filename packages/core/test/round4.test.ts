import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  cellFlags,
  cellPaletteIndex,
  collectionClip,
  collectionProblem,
  COLLISION_SOLID,
  createDocument,
  createStamp,
  DEFAULT_PROJECT_SETTINGS,
  FLIP_D,
  FLIP_H,
  FLIP_V,
  flipClip,
  FormatError,
  makeCell,
  normalizeCollection,
  normalizeProjectSettings,
  normalizeRandomSet,
  parseLevel,
  parseProject,
  parseStamp,
  pickRandomCandidate,
  placeStamp,
  randomChunkAt,
  randomSetProblem,
  remapCollectionsForTileset,
  remapRandomSetsForTileset,
  rotateCellFlags,
  rotateClip,
  serializeLevel,
  serializeProject,
  serializeStamp,
  withStampMeta,
  type ClipLayer,
  type MapStore,
  type Collection,
  type RandomSet,
  type StoreChangeEvent,
  type TileClip,
} from "../src";
import { makeStore, TERRAIN_TILESET, TILESET } from "./helpers";

// ------------------------------------------------------------------ rotation

const FLAG_SETS = [0, FLIP_D, FLIP_V, FLIP_V | FLIP_D, FLIP_H, FLIP_H | FLIP_D, FLIP_H | FLIP_V, FLIP_H | FLIP_V | FLIP_D].map((f) => f >>> 0);

function clipArb(): fc.Arbitrary<TileClip> {
  return fc
    .record({ w: fc.integer({ min: 1, max: 5 }), h: fc.integer({ min: 1, max: 5 }), grid: fc.boolean() })
    .chain(({ w, h, grid }) =>
      fc
        .tuple(
          fc.array(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.constantFrom(...FLAG_SETS)), { minLength: w * h, maxLength: w * h }),
          fc.array(fc.integer({ min: 0, max: 2 }), { minLength: w * h, maxLength: w * h }),
        )
        .map(([tiles, values]): TileClip => {
          const layers: ClipLayer[] = [{ layerId: "t", name: "T", cells: Uint32Array.from(tiles.map(([i, f]) => makeCell(i, f))) }];
          if (grid) layers.push({ layerId: "g", name: "G", grid: true, role: "collision", cells: Uint32Array.from(values) });
          return {
            width: w,
            height: h,
            palette: [1, 2, 3].map((tileId) => ({ tilesetId: "grass", tileId })),
            layers,
          };
        }),
    );
}

const cellsOf = (clip: TileClip) => ({ w: clip.width, h: clip.height, layers: clip.layers.map((l) => [...l.cells]) });

describe("rotation", () => {
  it("rotateCellFlags follows the Tiled orientation tables", () => {
    const mask = (f: number) => ((f & FLIP_H) ? 4 : 0) | ((f & FLIP_V) ? 2 : 0) | ((f & FLIP_D) ? 1 : 0);
    const cw = FLAG_SETS.map((f) => mask(cellFlags(rotateCellFlags(makeCell(7, f), "cw"))));
    const ccw = FLAG_SETS.map((f) => mask(cellFlags(rotateCellFlags(makeCell(7, f), "ccw"))));
    expect(cw).toEqual([5, 4, 1, 0, 7, 6, 3, 2]);
    expect(ccw).toEqual([3, 2, 7, 6, 1, 0, 5, 4]);
    expect(cellPaletteIndex(rotateCellFlags(makeCell(7, FLIP_H), "cw"))).toBe(7);
    expect(rotateCellFlags(0, "cw")).toBe(0);
  });

  it("rotateClip moves positions (cw: (x, y) → (h-1-y, x)) and swaps the size", () => {
    // 3 wide, 2 high: a b c / d e f
    const clip: TileClip = {
      width: 3,
      height: 2,
      palette: [1, 2, 3, 4, 5, 6].map((tileId) => ({ tilesetId: "grass", tileId })),
      layers: [
        { layerId: "t", name: "T", cells: Uint32Array.from([1, 2, 3, 4, 5, 6].map((i) => makeCell(i))) },
        { layerId: "g", name: "G", grid: true, role: "collision", cells: Uint32Array.from([1, 0, 0, 0, 0, 2]) },
      ],
    };
    const cw = rotateClip(clip, "cw");
    expect([cw.width, cw.height]).toEqual([2, 3]);
    // d a / e b / f c
    expect([...cw.layers[0]!.cells].map(cellPaletteIndex)).toEqual([4, 1, 5, 2, 6, 3]);
    expect([...cw.layers[0]!.cells].every((c) => cellFlags(c) === (FLIP_H | FLIP_D) >>> 0)).toBe(true);
    // grid values only move
    expect([...cw.layers[1]!.cells]).toEqual([0, 1, 0, 0, 2, 0]);
    expect(cw.layers[1]!.role).toBe("collision");
    const ccw = rotateClip(clip, "ccw");
    // c f / b e / a d
    expect([...ccw.layers[0]!.cells].map(cellPaletteIndex)).toEqual([3, 6, 2, 5, 1, 4]);
  });

  it("rotate ×4 = identity, cw∘ccw = identity, cw² = flip x∘flip y", () => {
    fc.assert(
      fc.property(clipArb(), (clip) => {
        let r = clip;
        for (let i = 0; i < 4; i++) r = rotateClip(r, "cw");
        expect(cellsOf(r)).toEqual(cellsOf(clip));
        expect(cellsOf(rotateClip(rotateClip(clip, "cw"), "ccw"))).toEqual(cellsOf(clip));
        expect(cellsOf(rotateClip(rotateClip(clip, "ccw"), "ccw"))).toEqual(cellsOf(flipClip(flipClip(clip, "x"), "y")));
        // flip x then cw = ccw then flip y (both are the anti-diagonal mirror up to order)
        expect(cellsOf(rotateClip(flipClip(clip, "x"), "cw"))).toEqual(cellsOf(flipClip(rotateClip(clip, "cw"), "y")));
      }),
      { numRuns: 200 },
    );
  });

  it("keeps a stamp's id, name and metadata (also flipClip)", () => {
    const { store, cell } = makeStore(10, 10);
    store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ x: 0, y: 0, cell: cell(1) }] });
    const stamp = createStamp(store.document, ["ground"], { x: 0, y: 0, width: 2, height: 1 }, { id: "s", name: "S", category: "Ev", favorite: true });
    const r = rotateClip(stamp, "cw");
    expect([r.id, r.name, r.category, r.favorite]).toEqual(["s", "S", "Ev", true]);
    expect([r.width, r.height]).toEqual([1, 2]);
    expect(flipClip(stamp, "x").id).toBe("s");
  });

  it("placeStamp rotate turns before flipping and places the top-left corner at (x, y)", () => {
    const { store, cell } = makeStore(20, 20);
    store.dispatch({ type: "addLayer", layer: { id: "col", name: "Collision", type: "grid", role: "collision" } });
    store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ x: 0, y: 0, cell: cell(1) }, { x: 1, y: 0, cell: cell(2) }, { x: 2, y: 0, cell: cell(3) }] });
    store.dispatch({ type: "paintTerrain", layerId: "col", cells: [{ x: 2, y: 0, value: COLLISION_SOLID }] });
    store.clearHistory();
    const stamp = createStamp(store.document, ["ground", "col"], { x: 0, y: 0, width: 3, height: 1 }, { id: "row", name: "Row" });
    placeStamp(store, stamp, 10, 10, { rotate: 1 });
    const g = store.document.getLayer("ground")!;
    expect([0, 1, 2].map((dy) => cellPaletteIndex(g.getCell(10, 10 + dy)))).toEqual([1, 2, 3]);
    expect(cellFlags(g.getCell(10, 10))).toBe((FLIP_H | FLIP_D) >>> 0);
    expect(store.document.getLayer("col")!.getCell(10, 12)).toBe(COLLISION_SOLID);
    expect(store.undoDepth).toBe(1);
    placeStamp(store, stamp, 5, 5, { rotate: 3, flip: { y: true } });
    // ccw: column with a (bottom) … c (top); flip y → a top
    expect([0, 1, 2].map((dy) => cellPaletteIndex(g.getCell(5, 5 + dy)))).toEqual([1, 2, 3]);
    placeStamp(store, stamp, 0, 15, { rotate: 2 });
    expect([0, 1, 2].map((dx) => cellPaletteIndex(g.getCell(dx, 15)))).toEqual([3, 2, 1]);
    expect(() => placeStamp(store, stamp, 0, 0, { rotate: 4 as 0 })).toThrow(RangeError);
  });
});

// ------------------------------------------------------------------ random sets

const SET: RandomSet = {
  id: "grass-mix",
  name: "Çimen",
  candidates: [
    { kind: "tile", tilesetId: "grass", tileId: 1, weight: 3 },
    { kind: "tile", tilesetId: "grass", tileId: 2, flags: FLIP_H },
    { kind: "stamp", stampId: "rock", weight: 0 },
  ],
};

describe("random sets", () => {
  it("validates and normalizes (defaults left out, fixed key order)", () => {
    expect(randomSetProblem(SET)).toBeNull();
    expect(randomSetProblem({ ...SET, candidates: [] })).toMatch(/at least one/);
    expect(randomSetProblem({ ...SET, candidates: [{ kind: "tile", tilesetId: "grass", tileId: 1, weight: 0 }] })).toMatch(/weights are 0/);
    expect(randomSetProblem({ ...SET, scatter: 1.5 })).toMatch(/scatter/);
    expect(randomSetProblem({ ...SET, chunk: { w: 0, h: 2 } })).toMatch(/chunk/);
    expect(randomSetProblem({ ...SET, candidates: [{ kind: "stamp", stampId: "../x" }] })).toMatch(/stamp id/);
    expect(randomSetProblem({ ...SET, candidates: [{ kind: "tile", tilesetId: "grass", tileId: 1, flags: 5 }] })).toMatch(/flip bits/);
    const n = normalizeRandomSet({ ...SET, scatter: 0, chunk: { w: 1, h: 1 }, randomFlip: false, candidates: [{ weight: 1, tileId: 4, tilesetId: "g", kind: "tile", flags: 0 }] });
    expect(JSON.stringify(n)).toBe('{"id":"grass-mix","name":"Çimen","candidates":[{"kind":"tile","tilesetId":"g","tileId":4}]}');
  });

  it("picks deterministically by weight; zero-weight candidates never win", () => {
    const counts = new Map<string, number>();
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 60; x++) {
        const a = pickRandomCandidate(SET, 7, x, y)!;
        expect(pickRandomCandidate(SET, 7, x, y)).toEqual(a);
        const key = a.candidate.kind === "tile" ? String(a.candidate.tileId) : "stamp";
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (a.candidate.kind === "tile" && a.candidate.tileId === 2) expect(a.flags).toBe(FLIP_H);
        expect([a.anchorX, a.anchorY]).toEqual([x, y]);
      }
    }
    expect(counts.get("stamp")).toBeUndefined();
    const share = counts.get("1")! / 3600;
    expect(share).toBeGreaterThan(0.7);
    expect(share).toBeLessThan(0.8);
    expect(() => pickRandomCandidate({ ...SET, candidates: [] }, 0, 0, 0)).toThrow(RangeError);
  });

  it("scatter leaves about that share empty without changing the picks of the rest", () => {
    const sparse = { ...SET, scatter: 0.75 };
    let empty = 0;
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        const p = pickRandomCandidate(sparse, 3, x, y);
        if (p === null) empty++;
        else expect(p).toEqual(pickRandomCandidate(SET, 3, x, y));
      }
    }
    expect(empty / 2500).toBeGreaterThan(0.7);
    expect(empty / 2500).toBeLessThan(0.8);
    expect(pickRandomCandidate({ ...SET, scatter: 1 }, 3, 0, 0)).toBeNull();
  });

  it("chunks share one pick per aligned block, also at negative coordinates", () => {
    const set: RandomSet = { ...SET, chunk: { w: 2, h: 3 } };
    expect(randomChunkAt(set, -1, -1)).toEqual({ x: -2, y: -3, width: 2, height: 3 });
    expect(randomChunkAt(SET, 5, 6)).toEqual({ x: 5, y: 6, width: 1, height: 1 });
    for (let y = -6; y < 6; y++) {
      for (let x = -4; x < 4; x++) {
        const p = pickRandomCandidate(set, 1, x, y)!;
        const anchor = randomChunkAt(set, x, y);
        expect([p.anchorX, p.anchorY]).toEqual([anchor.x, anchor.y]);
        expect(p).toEqual(pickRandomCandidate(set, 1, anchor.x, anchor.y));
      }
    }
  });

  it("randomFlip adds H/V flips (XOR with the candidate's flags), deterministic per anchor", () => {
    const set: RandomSet = { ...SET, randomFlip: true };
    const seen = new Set<number>();
    for (let x = 0; x < 64; x++) {
      const p = pickRandomCandidate(set, 9, x, 0)!;
      const base = pickRandomCandidate(SET, 9, x, 0)!;
      expect(p.candidate).toEqual(base.candidate);
      const random = (p.flags ^ base.flags) >>> 0;
      expect(random & ~(FLIP_H | FLIP_V)).toBe(0);
      seen.add(random);
    }
    expect(seen.size).toBe(4);
  });

  it("setRandomSet / removeRandomSet are undoable project data and check tiles", () => {
    const { store } = makeStore(8, 8);
    const events: StoreChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    store.dispatch({ type: "setRandomSet", set: SET });
    expect(store.document.randomSets).toEqual([normalizeRandomSet(SET)]);
    expect(events.at(-1)!.structure).toEqual(["randomSets"]);
    const depth = store.undoDepth;
    store.dispatch({ type: "setRandomSet", set: SET }); // no-op
    expect(store.undoDepth).toBe(depth);
    store.dispatch({ type: "setRandomSet", set: { ...SET, name: "B" } });
    store.dispatch({ type: "setRandomSet", set: { ...SET, id: "two" } });
    expect(store.document.randomSets.map((s) => [s.id, s.name])).toEqual([["grass-mix", "B"], ["two", "Çimen"]]);
    store.dispatch({ type: "removeRandomSet", id: "grass-mix" });
    expect(store.document.getRandomSet("grass-mix")).toBeUndefined();
    store.undo();
    store.undo();
    store.undo();
    expect(store.document.randomSets.map((s) => s.name)).toEqual(["Çimen"]);
    expect(() => store.dispatch({ type: "removeRandomSet", id: "nope" })).toThrow();
    expect(() => store.dispatch({ type: "setRandomSet", set: { ...SET, candidates: [{ kind: "tile", tilesetId: "x", tileId: 0 }] } })).toThrow(/unknown tileset/);
    expect(() => store.dispatch({ type: "setRandomSet", set: { ...SET, candidates: [{ kind: "tile", tilesetId: "grass", tileId: 64 }] } })).toThrow(/outside/);
  });
});

// ------------------------------------------------------------------ collections

const PAL: Collection = {
  id: "pal-1",
  name: "Dış mekân",
  columns: 4,
  cells: [
    { x: 1, y: 1, tilesetId: "grass", tileId: 9, flags: FLIP_V },
    { x: 0, y: 0, tilesetId: "grass", tileId: 3 },
    { x: 3, y: 0, tilesetId: "terrain", tileId: 5 },
  ],
};

describe("collections", () => {
  it("validates and normalizes (sorted y, x)", () => {
    expect(collectionProblem(PAL)).toBeNull();
    expect(collectionProblem({ ...PAL, cells: [...PAL.cells, { x: 0, y: 0, tilesetId: "grass", tileId: 1 }] })).toMatch(/two cells/);
    expect(collectionProblem({ ...PAL, cells: [{ x: 4, y: 0, tilesetId: "grass", tileId: 1 }] })).toMatch(/x must be/);
    expect(collectionProblem({ ...PAL, columns: 0 })).toMatch(/columns/);
    expect(normalizeCollection(PAL).cells.map((c) => [c.x, c.y])).toEqual([[0, 0], [3, 0], [1, 1]]);
  });

  it("collectionClip keeps layout and flags inside the bounding box", () => {
    const clip = collectionClip(PAL, { x: 0, y: 0, w: 2, h: 2 })!;
    expect([clip.width, clip.height]).toEqual([2, 2]);
    expect(clip.palette).toEqual([{ tilesetId: "grass", tileId: 3 }, { tilesetId: "grass", tileId: 9 }]);
    expect([...clip.layers[0]!.cells]).toEqual([makeCell(1), 0, 0, makeCell(2, FLIP_V)]);
    const picked = collectionClip(PAL, [{ x: 3, y: 0 }, { x: 1, y: 1 }], { layerId: "L" })!;
    expect([picked.width, picked.height, picked.layers[0]!.layerId]).toEqual([3, 2, "L"]);
    expect(collectionClip(PAL, { x: 2, y: 2, w: 1, h: 1 })).toBeNull();
  });

  it("remap helpers return the same array when nothing changes", () => {
    const list = [normalizeCollection(PAL)];
    expect(remapCollectionsForTileset(list, "other", () => null)).toBe(list);
    expect(remapCollectionsForTileset(list, "grass", (id) => id)).toBe(list);
    const moved = remapCollectionsForTileset(list, "grass", (id) => (id === 3 ? null : id + 1));
    expect(moved[0]!.cells.map((c) => [c.tilesetId, c.tileId])).toEqual([["terrain", 5], ["grass", 10]]);
    const sets = [normalizeRandomSet(SET)];
    expect(remapRandomSetsForTileset(sets, "grass", (id) => id)).toBe(sets);
    expect(remapRandomSetsForTileset(sets, "grass", () => null)).toEqual([]); // only the zero-weight stamp left
  });

  it("setCollection / removeCollection are undoable; removeTileset drops refs in the same step", () => {
    const { store } = makeStore(8, 8);
    store.dispatch({ type: "addTileset", tileset: TERRAIN_TILESET });
    store.dispatch({ type: "setCollection", collection: PAL });
    store.dispatch({ type: "setRandomSet", set: SET });
    store.dispatch({ type: "setRandomSet", set: { id: "t", name: "T", candidates: [{ kind: "tile", tilesetId: "terrain", tileId: 1 }, { kind: "tile", tilesetId: "grass", tileId: 4 }] } });
    store.clearHistory();
    const before = snap(store);
    store.dispatch({ type: "removeTileset", tilesetId: "grass" });
    expect(store.undoDepth).toBe(1);
    expect(store.document.collections[0]!.cells.map((c) => c.tilesetId)).toEqual(["terrain"]);
    expect(store.document.randomSets.map((s) => [s.id, s.candidates.length])).toEqual([["t", 1]]);
    store.undo();
    expect(snap(store)).toBe(before);
    store.dispatch({ type: "removeCollection", id: "pal-1" });
    expect(store.document.collections).toEqual([]);
    store.undo();
    expect(snap(store)).toBe(before);
    expect(() => store.dispatch({ type: "setCollection", collection: { ...PAL, cells: [{ x: 0, y: 0, tilesetId: "nope", tileId: 0 }] } })).toThrow();
    expect(() => store.dispatch({ type: "removeCollection", id: "x" })).toThrow();
  });

  it("tileset grid edits remap collection cells and random set tiles by pixel position", () => {
    const { store } = makeStore(8, 8);
    // grass: 8 columns of 32 px. Tile 9 = (col 1, row 1).
    store.dispatch({ type: "setCollection", collection: { id: "c", name: "C", columns: 2, cells: [{ x: 0, y: 0, tilesetId: "grass", tileId: 9 }, { x: 1, y: 0, tilesetId: "grass", tileId: 7 }] } });
    store.clearHistory();
    // 4 columns of 64 px: old tile 9 (pixel 32,32) has no new tile at that pixel → dropped; tile 0 stays.
    store.dispatch({ type: "updateTilesetGrid", tilesetId: "grass", tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 });
    // 16 px over a 256 px image: 16 columns. Old 9 → pixel (32,32) → new (2,2) = 34; old 7 → (224,0) → 14.
    expect(store.document.collections[0]!.cells.map((c) => c.tileId)).toEqual([34, 14]);
    store.undo();
    expect(store.document.collections[0]!.cells.map((c) => c.tileId)).toEqual([9, 7]);
  });
});

// ------------------------------------------------------------------ stamp metadata

describe("stamp metadata", () => {
  it("serializes only set fields after name and roundtrips; old files are unchanged", () => {
    const { store, cell } = makeStore(10, 10);
    store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ x: 0, y: 0, cell: cell(1) }] });
    const plain = createStamp(store.document, ["ground"], { x: 0, y: 0, width: 1, height: 1 }, { id: "a", name: "A" });
    const plainText = serializeStamp(plain);
    expect(plainText).not.toMatch(/category|tags|favorite/);
    expect(serializeStamp(parseStamp(plainText))).toBe(plainText);
    const rich = withStampMeta(plain, { category: " Binalar ", tags: ["ev", " ev", "", "köy"], favorite: true });
    expect([rich.category, rich.tags, rich.favorite]).toEqual(["Binalar", ["ev", "köy"], true]);
    const text = serializeStamp(rich);
    expect(text.indexOf('"name"')).toBeLessThan(text.indexOf('"category"'));
    expect(text.indexOf('"favorite"')).toBeLessThan(text.indexOf('"width"'));
    const parsed = parseStamp(text);
    expect(serializeStamp(parsed)).toBe(text);
    expect(serializeStamp(withStampMeta(parsed, { category: "", tags: [], favorite: false }))).toBe(plainText);
    expect(() => parseStamp(text.replace('"favorite": true', '"favorite": "yes"'))).toThrow(FormatError);
    expect(() => withStampMeta(plain, { tags: [1 as unknown as string] })).toThrow();
  });
});

// ------------------------------------------------------------------ project settings / project data

describe("project settings", () => {
  it("defaults are not written; only non-default fields in fixed order", () => {
    const base = { name: "P", levels: [], tilesets: [] };
    const plain = serializeProject(base);
    expect(plain).not.toMatch(/settings|randomSets|collections/);
    expect(parseProject(plain).settings).toEqual(DEFAULT_PROJECT_SETTINGS);
    const text = serializeProject({
      ...base,
      settings: { unity: { exportOnSave: true }, background: "#AABBCC", newLevel: { height: 30 }, tileWidth: 16, layerTemplate: [{ name: "Zemin", kind: "tile" }, { name: "Collision", kind: "collision" }, { name: "Ent", kind: "entity" }] },
    });
    const settings = JSON.parse(text).settings;
    expect(Object.keys(settings)).toEqual(["tileWidth", "newLevel", "layerTemplate", "background", "unity"]);
    expect(settings.newLevel).toEqual({ height: 30 });
    expect(settings.unity).toEqual({ exportOnSave: true });
    expect(settings.background).toBe("#aabbcc");
    const parsed = parseProject(text);
    expect(parsed.settings.tileHeight).toBe(32);
    expect(parsed.settings.newLevel).toEqual({ width: 64, height: 30 });
    expect(serializeProject(parsed)).toBe(text);
    expect(serializeProject({ ...base, settings: DEFAULT_PROJECT_SETTINGS })).toBe(plain);
  });

  it("rejects invalid settings", () => {
    expect(() => normalizeProjectSettings({ tileWidth: 0 })).toThrow(/tileWidth/);
    expect(() => normalizeProjectSettings({ background: "red" })).toThrow(/background/);
    expect(() => normalizeProjectSettings({ layerTemplate: [{ name: "a", kind: "grid" as "tile" }] })).toThrow(/kind/);
    expect(() => normalizeProjectSettings({ layerTemplate: [{ name: "a", kind: "tile" }, { name: "a", kind: "entity" }] })).toThrow(/unique/);
    const text = serializeProject({ name: "P", levels: [], tilesets: [], settings: { tileWidth: 16 } });
    expect(() => parseProject(text.replace('"tileWidth": 16', '"tileWidth": -1'))).toThrow(FormatError);
  });

  it("random sets and collections roundtrip through project.smap", () => {
    const text = serializeProject({ name: "P", levels: [], tilesets: [TILESET], randomSets: [SET], collections: [PAL] });
    const parsed = parseProject(text);
    expect(parsed.randomSets).toEqual([normalizeRandomSet(SET)]);
    expect(parsed.collections).toEqual([normalizeCollection(PAL)]);
    expect(serializeProject(parsed)).toBe(text);
    const keys = Object.keys(JSON.parse(text));
    expect(keys.indexOf("randomSets")).toBeLessThan(keys.indexOf("collections"));
    expect(() => parseProject(text.replace('"columns": 4', '"columns": 0'))).toThrow(FormatError);
    expect(() => parseProject(text.replace('"stampId": "rock"', '"stampId": "../rock"'))).toThrow(FormatError);
  });

  it("documents carry project random sets / collections via createDocument and parseLevel", () => {
    const doc = createDocument({ width: 4, height: 4, tilesets: [TILESET], randomSets: [SET], collections: [PAL] });
    expect(doc.randomSets).toEqual([normalizeRandomSet(SET)]);
    const loaded = parseLevel(serializeLevel(doc), [TILESET], [], { randomSets: doc.randomSets, collections: doc.collections });
    expect(loaded.collections).toEqual(doc.collections);
    expect(() => createDocument({ width: 4, height: 4, randomSets: [SET, SET] })).toThrow(/duplicate/);
  });
});

// ------------------------------------------------------------------ level props

describe("level background / name", () => {
  it("setMapProps is undoable, validated and saved only when set", () => {
    const { store } = makeStore(6, 6);
    const plain = serializeLevel(store.document);
    expect(plain).not.toMatch(/background/);
    const events: StoreChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    store.dispatch({ type: "setMapProps", background: "#1A2B3C", name: "Zindan" });
    expect(store.document.background).toBe("#1a2b3c");
    expect(events.at(-1)!.structure).toEqual(["props"]);
    const text = serializeLevel(store.document);
    expect(text.indexOf('"background"')).toBeLessThan(text.indexOf('"palette"'));
    const loaded = parseLevel(text, [TILESET]);
    expect(loaded.props).toEqual({ background: "#1a2b3c", name: "Zindan" });
    expect(serializeLevel(loaded)).toBe(text);
    const depth = store.undoDepth;
    store.dispatch({ type: "setMapProps", background: "#1a2b3c" });
    expect(store.undoDepth).toBe(depth);
    store.dispatch({ type: "setMapProps", background: null });
    expect(store.document.props).toEqual({ background: null, name: "Zindan" });
    store.undo();
    store.undo();
    expect(serializeLevel(store.document)).toBe(plain);
    expect(() => store.dispatch({ type: "setMapProps", background: "blue" })).toThrow(RangeError);
    expect(() => parseLevel(plain.replace('"palette"', '"background": "#12",\n  "palette"'), [TILESET])).toThrow(FormatError);
  });
});

// ------------------------------------------------------------------ history list

describe("history list", () => {
  it("lists undo then redo steps with kind, cell count and label; undoTo / redoTo jump", () => {
    const { store, cell } = makeStore(10, 10);
    store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ x: 0, y: 0, cell: cell(1) }, { x: 1, y: 0, cell: cell(1) }] });
    store.beginTransaction("Fırça");
    store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ x: 2, y: 0, cell: cell(1) }] });
    store.beginTransaction("inner");
    store.dispatch({ type: "addLayer", layer: { name: "N" } });
    store.commit();
    store.commit();
    store.dispatch({ type: "setMapProps", name: "x" });
    const items = store.historyEntries();
    expect(items.map((i) => [i.kind, i.cellCount, i.label, i.state])).toEqual([
      ["cells", 2, undefined, "done"],
      ["layer", 1, "Fırça", "done"],
      ["mapProps", undefined, undefined, "done"],
    ]);
    const [first, second, third] = items.map((i) => i.id);
    const snapshot = serializeLevel(store.document);
    expect(store.undoTo(second!)).toBe(2);
    expect(store.historyEntries().map((i) => [i.id, i.state])).toEqual([
      [first, "done"],
      [second, "undone"],
      [third, "undone"],
    ]);
    expect(store.undoTo(second!)).toBe(0); // not on the undo stack any more
    expect(store.redoTo(second!)).toBe(1);
    expect(store.redoTo(third!)).toBe(1);
    expect(serializeLevel(store.document)).toBe(snapshot);
    expect(store.undoTo(first!)).toBe(3);
    expect(store.canUndo).toBe(false);
    store.beginTransaction();
    expect(store.redoTo(third!)).toBe(0);
    store.commit();
    expect(store.redoTo(third!)).toBe(3);
    expect(serializeLevel(store.document)).toBe(snapshot);
    // rollback discards the pending label
    store.beginTransaction("gone");
    store.rollback();
    store.dispatch({ type: "setMapProps", name: "y" });
    expect(store.historyEntries().at(-1)!.label).toBeUndefined();
  });
});

function snap(store: MapStore): string {
  const d = store.document;
  return serializeLevel(d) + serializeProject({ name: "p", levels: [], tilesets: d.tilesets, entityTypes: d.entityTypes, randomSets: d.randomSets, collections: d.collections });
}
