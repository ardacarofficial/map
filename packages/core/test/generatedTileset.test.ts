import { buildLayout1RoadProfile } from "../src/smartStamp/roadProfile";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createDocument, MapStore, cellFlags, FLIP_H, makeCell, serializeProject, parseProject, serializeLevel, parseLevel, tilesetUsage, stampTilesetUsage, prepareNineSliceTileset, regenerateNineSliceTileset, generatedTilesetStale, BLOB47_MASKS, nineSliceBlits, nineSliceLayout, type Stamp, type Tileset } from "../src";
import { source } from "./smartStampHelpers";

const art: Tileset = { id: "source", name: "Art", imagePath: "tilesets/art.png", tileWidth: 5, tileHeight: 5, columns: 3, rows: 3, margin: 0, spacing: 0 };
const stamp: Stamp = { ...source(), id: "road", name: "Yol" };
const options = (imageHash = "sha256:old") => ({ id: "road-baked", imagePath: "tilesets/road-baked.png", tileWidth: 5, tileHeight: 5, tilesets: [art], imageHashes: new Map([["source", imageHash]]) });

describe("generated nine-slice assets", () => {
  it("prepares a separate ordinary PNG and records source hashes without mutating source metadata", () => {
    const before = JSON.stringify(art), baked = prepareNineSliceTileset(stamp, "s", options());
    expect(baked).toMatchObject({ id: "road-baked", name: "Yol (yol)", imagePath: "tilesets/road-baked.png", generated: { kind: "nineSlice", stampId: "road", layerId: "s", sourceWidth: 3, sourceHeight: 3, layoutVersion: 1, sources: [{ tilesetId: "source", imageHash: "sha256:old" }] } });
    expect(JSON.stringify(art)).toBe(before); expect(art).not.toHaveProperty("generated");
    expect(generatedTilesetStale(baked, options().imageHashes)).toBe(false);
    expect(generatedTilesetStale(baked, options("sha256:new").imageHashes)).toBe(true);
    expect(generatedTilesetStale(baked, new Map())).toBe(true);
    expect(generatedTilesetStale(art, new Map())).toBe(false);
    expect(Object.isFrozen(baked.generated!.sources[0])).toBe(true);
  });

  it("pins the version-1 slot ABI and produces the same ordered blits on every bake", () => {
    expect(nineSliceLayout(stamp)).toEqual({ source: 0, collapsedWidth: 9, collapsedHeight: 12, isolated: 15, bank: 16, slots: 63 });
    expect(BLOB47_MASKS).toEqual([0, 1, 4, 5, 7, 16, 17, 20, 21, 23, 28, 29, 31, 64, 65, 68, 69, 71, 80, 81, 84, 85, 87, 92, 93, 95, 112, 113, 116, 117, 119, 124, 125, 127, 193, 197, 199, 209, 213, 215, 221, 223, 241, 245, 247, 253, 255]);
    const first = nineSliceBlits(stamp, "s", 5, 5), second = nineSliceBlits(stamp, "s", 5, 5);
    expect(second).toEqual(first);
    expect([...new Set(first.map(b => b.slot))]).toEqual(Array.from({ length: 63 }, (_, i) => i));
    const changed = { ...stamp, layers: [{ ...stamp.layers[0]!, cells: Uint32Array.from(stamp.layers[0]!.cells, c => makeCell(c, FLIP_H)) }] };
    expect(nineSliceBlits(changed, "s", 5, 5).map(b => [b.slot, b.destinationRect])).toEqual(first.map(b => [b.slot, b.destinationRect]));
    const grown = { ...prepareNineSliceTileset(stamp, "s", options()), rows: 20 };
    expect(prepareNineSliceTileset(stamp, "s", { ...options("sha256:new"), tilesets: [art, grown] })).toMatchObject({ id: grown.id, columns: grown.columns, rows: 20 });
  });

  it("never reuses a user tileset id/path and includes optional inner-corner image dependencies", () => {
    for (const change of [{ id: "source" }, { imagePath: "tilesets/art.png" }, { imagePath: "tilesets/ART.PNG" }, { imagePath: "outside.png" }]) expect(() => prepareNineSliceTileset(stamp, "s", { ...options(), ...change })).toThrow();
    const inner: Tileset = { ...art, id: "inner", imagePath: "tilesets/inner.png" };
    const baked = prepareNineSliceTileset(stamp, "s", { ...options(), tilesets: [inner, art], imageHashes: new Map([["inner", "hash-i"], ["source", "hash-s"]]), innerCorner: { tile: { tilesetId: "inner", tileId: 0 } } });
    expect(baked.generated!.sources.map(s => s.tilesetId)).toEqual(["inner", "source"]);
    expect(generatedTilesetStale(baked, new Map([["inner", "changed"], ["source", "hash-s"]]))).toBe(true);
    expect(() => prepareNineSliceTileset(stamp, "s", { ...options(), imageHashes: new Map() })).toThrow(/hash/);
  });

  it("regenerates in place, retains placed cell ids/flags, and roundtrips/undoes source-hash updates", () => {
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 40 }), hash => {
      const first = prepareNineSliceTileset(stamp, "s", options());
      const store = new MapStore(createDocument({ width: 3, height: 3, tileWidth: 5, tileHeight: 5, tilesets: [art, first] }));
      store.dispatch({ type: "addLayer", layer: { id: "l", name: "L" } });
      const cell = makeCell(store.getOrAddPaletteIndex(first.id, 62), FLIP_H);
      store.dispatch({ type: "paintCells", layerId: "l", cells: [{ x: 1, y: 1, cell }] }); store.clearHistory();
      const level = serializeLevel(store.document), before = serializeProject({ name: "P", levels: [], tilesets: store.document.tilesets });
      const next = regenerateNineSliceTileset(stamp, "s", first.id, { tilesets: store.document.tilesets, imageHashes: options(hash).imageHashes });
      expect(next.id).toBe(first.id); expect(next.imagePath).toBe(first.imagePath); expect(next.generated!.layoutVersion).toBe(first.generated!.layoutVersion);
      store.dispatch({ type: "setTilesetMeta", tilesetId: first.id, generated: next.generated! });
      expect(serializeLevel(store.document)).toBe(level); expect(cellFlags(store.document.getLayer("l")!.getCell(1, 1))).toBe(FLIP_H);
      const saved = serializeProject({ name: "P", levels: [], tilesets: store.document.tilesets });
      const project = parseProject(saved); expect(serializeProject(project)).toBe(saved);
      expect(serializeLevel(parseLevel(level, project.tilesets))).toBe(level);
      store.undo(); expect(serializeProject({ name: "P", levels: [], tilesets: store.document.tilesets })).toBe(before);
      store.redo(); expect(serializeProject({ name: "P", levels: [], tilesets: store.document.tilesets })).toBe(saved);
      expect(generatedTilesetStale(project.tilesets[1]!, new Map([["source", hash]]))).toBe(false);
    }), { numRuns: 25 });
  });

  it("rejects resizing/repacking an existing generated ABI and cannot turn a user asset into generated metadata", () => {
    const first = prepareNineSliceTileset(stamp, "s", options()), tilesets = [art, first];
    expect(() => prepareNineSliceTileset({ ...stamp, ...source(4, 3) }, "s", { ...options(), tilesets })).toThrow(/dimensions/);
    expect(() => prepareNineSliceTileset(stamp, "s", { ...options(), tilesets, columns: 4 })).toThrow(/columns/);
    const store = new MapStore(createDocument({ width: 3, height: 3, tilesets }));
    expect(() => store.dispatch({ type: "setTilesetMeta", tilesetId: "source", generated: first.generated! })).toThrow(/generated/);
    expect(() => store.dispatch({ type: "updateTilesetGrid", tilesetId: first.id, tileWidth: 1, tileHeight: 1, margin: 0, spacing: 0, imageWidth: 40, imageHeight: 40 })).toThrow(/generated/);
  });

  it("uses map usage counting and adds stamp cells and baked-profile references without counting grids/palette-only entries", () => {
    const baked = prepareNineSliceTileset(stamp, "s", options()), store = new MapStore(createDocument({ width: 3, height: 3, tilesets: [art, baked] }));
    store.dispatch({ type: "addLayer", layer: { id: "l", name: "L", visible: false, locked: false } });
    const c = makeCell(store.getOrAddPaletteIndex(baked.id, 0), FLIP_H); store.getOrAddPaletteIndex(baked.id, 62);
    store.dispatch({ type: "paintCells", layerId: "l", cells: [{ x: 0, y: 0, cell: c }, { x: 1, y: 1, cell: c }] });
    expect(tilesetUsage(store.document, baked.id).cells).toBe(2);
    const saved: Stamp = { ...stamp, palette: [...stamp.palette, { tilesetId: baked.id, tileId: 62 }], layers: [...stamp.layers, { layerId: "g", name: "Grid", grid: true, cells: new Uint32Array(9).fill(1) }], nineSlice: { border: 1, tileLayers: [{ layerId: "s", tilesetId: baked.id }], road: { tilesetId: baked.id, profile: buildLayout1RoadProfile(3, 3) } } };
    expect(stampTilesetUsage(saved, "source")).toEqual({ cells: 9, layers: ["s"], bakedLayers: [], road: false });
    expect(stampTilesetUsage(saved, baked.id)).toEqual({ cells: 0, layers: [], bakedLayers: ["s"], road: true });
    expect(stampTilesetUsage({ ...saved, layers: [{ ...saved.layers[0]!, cells: new Uint32Array(9).fill(makeCell(10, FLIP_H)) }] }, baked.id).cells).toBe(9);
  });
});

it("serializes generated metadata in fixed v3 key order, never inferring it from a name on old assets", () => {
  const baked = prepareNineSliceTileset(stamp, "s", options()), text = serializeProject({ name: "P", levels: [], tilesets: [art, baked] }), parsed = JSON.parse(text);
  expect(parsed.documentFormatVersion).toBe(4);
  expect(Object.keys(parsed.tilesets[1])).toEqual(["id", "name", "generated", "imagePath", "tileWidth", "tileHeight", "columns", "rows", "margin", "spacing"]);
  expect(Object.keys(parsed.tilesets[1].generated)).toEqual(["kind", "stampId", "layerId", "sourceWidth", "sourceHeight", "layoutVersion", "sources"]);
  expect(Object.keys(parsed.tilesets[1].generated.sources[0])).toEqual(["tilesetId", "imageHash"]);
  expect(serializeProject(parseProject(text))).toBe(text);
  for (const version of [1, 2]) {
    const old = parseProject(JSON.stringify({ ...parsed, documentFormatVersion: version }));
    expect(old.tilesets.every(t => t.generated === undefined)).toBe(true);
    const saved = serializeProject(old);
    expect(serializeProject(parseProject(saved))).toBe(saved);
    expect(saved).not.toContain('"generated"');
  }
});

it("rejects malformed generated provenance and maintains no-op/rollback semantics", () => {
  const baked = prepareNineSliceTileset(stamp, "s", options()), valid = JSON.parse(serializeProject({ name: "P", levels: [], tilesets: [baked] }));
  for (const value of [null, { ...baked.generated!, layoutVersion: 2 }, { ...baked.generated!, sourceWidth: 2 }, { ...baked.generated!, sources: [{ tilesetId: "source", imageHash: "" }] }, { ...baked.generated!, sources: [...baked.generated!.sources, ...baked.generated!.sources] }]) {
    const root = { ...valid, tilesets: [{ ...valid.tilesets[0], generated: value }] };
    expect(() => parseProject(JSON.stringify(root))).toThrow(/generated/);
  }
  for (const innerCorner of [{ tile: { tilesetId: "missing", tileId: 0 } }, { tile: { tilesetId: "source", tileId: -1 } }, { tile: { tilesetId: "source", tileId: 0 }, flags: 1 }, { tile: { tilesetId: "source", tileId: 0 }, flags: null }]) {
    expect(() => parseProject(JSON.stringify({ ...valid, tilesets: [{ ...valid.tilesets[0], generated: { ...baked.generated, innerCorner } }] }))).toThrow(/innerCorner/);
  }
  const store = new MapStore(createDocument({ width: 3, height: 3, tilesets: [art, baked] }));
  store.dispatch({ type: "setTilesetMeta", tilesetId: baked.id, generated: { ...baked.generated! } });
  expect(store.undoDepth).toBe(0);
  const before = serializeProject({ name: "P", levels: [], tilesets: store.document.tilesets });
  expect(() => store.dispatch({ type: "setTilesetMeta", tilesetId: baked.id, generated: { ...baked.generated!, sourceWidth: 4 } })).toThrow();
  expect(serializeProject({ name: "P", levels: [], tilesets: store.document.tilesets })).toBe(before);
  const next = regenerateNineSliceTileset(stamp, "s", baked.id, { tilesets: store.document.tilesets, imageHashes: options("new").imageHashes });
  store.beginTransaction(); store.dispatch({ type: "setTilesetMeta", tilesetId: baked.id, generated: next.generated! }); store.rollback();
  expect(serializeProject({ name: "P", levels: [], tilesets: store.document.tilesets })).toBe(before);
  store.dispatch({ type: "replaceTilesetImage", tilesetId: baked.id, imageWidth: 40, imageHeight: 45 });
  expect(store.document.getTileset(baked.id)!.rows).toBe(9);
  expect(() => store.dispatch({ type: "replaceTilesetImage", tilesetId: baked.id, imageWidth: 40, imageHeight: 40 })).toThrow(/append-only/);
});

it("keeps deterministic slot/blit order for arbitrary recipes and PNG-only regeneration", () => {
  fc.assert(fc.property(fc.integer({ min: 3, max: 9 }), fc.integer({ min: 3, max: 9 }), fc.integer({ min: 1, max: 19 }), (width, height, pixels) => {
    const s: Stamp = { ...source(width, height), id: "road", name: "Road" }, input: Tileset = { ...art, columns: width, rows: height, tileWidth: pixels, tileHeight: pixels };
    const opts = { ...options(), tileWidth: pixels, tileHeight: pixels, tilesets: [input] };
    const first = prepareNineSliceTileset(s, "s", opts), blits = nineSliceBlits(s, "s", pixels, pixels);
    const regenerated = regenerateNineSliceTileset(s, "s", first.id, { tilesets: [first, input], imageHashes: options("changed PNG bytes").imageHashes });
    expect(regenerated).toMatchObject({ id: first.id, imagePath: first.imagePath, columns: first.columns, rows: first.rows });
    expect(nineSliceBlits(s, "s", pixels, pixels)).toEqual(blits);
    expect(regenerated.generated!.sources).not.toEqual(first.generated!.sources);
  }), { numRuns: 35 });
});

it("normalizes reordered generated sources/keys and preserves freshness across metadata edits", () => {
  const baked = prepareNineSliceTileset(stamp, "s", options());
  const generated = { ...baked.generated!, sources: [{ tilesetId: "z", imageHash: "z-hash" }, { tilesetId: "source", imageHash: "s-hash" }] };
  const a: Tileset = { ...baked, generated }, b: Tileset = { ...baked, generated: { sources: [...generated.sources].reverse().map(s => ({ imageHash: s.imageHash, tilesetId: s.tilesetId })), layoutVersion: 1, sourceHeight: 3, sourceWidth: 3, layerId: "s", stampId: "road", kind: "nineSlice" } };
  expect(serializeProject({ name: "P", levels: [], tilesets: [a] })).toBe(serializeProject({ name: "P", levels: [], tilesets: [b] }));
  const store = new MapStore(createDocument({ width: 1, height: 1, tilesets: [a] }));
  store.dispatch({ type: "setTilesetMeta", tilesetId: a.id, name: "Renamed", group: "Custom group" });
  expect(store.document.getTileset(a.id)!.generated).toEqual({ ...generated, sources: [...generated.sources].reverse() });
  store.clearHistory();
  store.dispatch({ type: "setTilesetMeta", tilesetId: a.id, generated: b.generated! });
  expect(store.undoDepth).toBe(0);
});

it("persists inner-corner tile/flags and restores the exact recipe for PNG-only regeneration after reopen", () => {
  const inner: Tileset = { ...art, id: "inner", imagePath: "tilesets/inner.png" }, innerCorner = { tile: { tilesetId: "inner", tileId: 4 }, flags: FLIP_H };
  const imageHashes = new Map([["source", "s-old"], ["inner", "i-old"]]);
  const first = prepareNineSliceTileset(stamp, "s", { ...options(), tilesets: [art, inner], imageHashes, innerCorner });
  expect(first.generated!.innerCorner).toEqual(innerCorner);
  const text = serializeProject({ name: "P", levels: [], tilesets: [art, inner, first] });
  const json = JSON.parse(text);
  expect(Object.keys(json.tilesets[2].generated)).toEqual(["kind", "stampId", "layerId", "sourceWidth", "sourceHeight", "layoutVersion", "innerCorner", "sources"]);
  expect(Object.keys(json.tilesets[2].generated.innerCorner)).toEqual(["tile", "flags"]);
  const reopened = parseProject(text);
  expect(serializeProject(reopened)).toBe(text);
  const next = regenerateNineSliceTileset(stamp, "s", first.id, { tilesets: reopened.tilesets, imageHashes: new Map([["source", "s-new"], ["inner", "i-new"]]) });
  expect(next.generated!.innerCorner).toEqual(innerCorner);
  expect(nineSliceBlits(stamp, "s", 5, 5, next.generated!.innerCorner)).toEqual(nineSliceBlits(stamp, "s", 5, 5, innerCorner));
  expect(next.generated!.sources).toEqual([{ tilesetId: "inner", imageHash: "i-new" }, { tilesetId: "source", imageHash: "s-new" }]);
  const cleared = regenerateNineSliceTileset(stamp, "s", first.id, { tilesets: reopened.tilesets, imageHashes, innerCorner: null });
  expect(cleared.generated!.innerCorner).toBeUndefined();
  expect(cleared.generated!.sources).toEqual([{ tilesetId: "source", imageHash: "s-old" }]);
});

it("cache provenance survives every structural undo/redo and rollback without changing history", () => {
  fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 40 }), fc.boolean(), (hash, rollback) => {
    const bank = prepareNineSliceTileset(stamp, "s", options());
    const store = new MapStore(createDocument({ width: 3, height: 3, tilesets: [art, bank] }));
    store.dispatch({ type: "addLayer", layer: { id: "l", name: "Ground" } });
    store.clearHistory();
    store.dispatch({ type: "setTilesetMeta", tilesetId: bank.id, name: "Custom name" });
    store.dispatch({ type: "moveTileset", tilesetId: bank.id, index: 0 });
    store.dispatch({ type: "removeTileset", tilesetId: bank.id });
    store.undo(); // Keep a redo removal and two undo snapshots of the bank.
    const history = store.historyEntries();
    const generated = { ...bank.generated!, sources: [{ tilesetId: "source", imageHash: hash }] };
    store.beginTransaction();
    store.dispatch({ type: "setTilesetMeta", tilesetId: bank.id, group: "Custom group" });
    store.dispatch({ type: "setTilesetMeta", tilesetId: bank.id, generated, undoable: false });
    if (rollback) store.rollback(); else store.commit();
    if (!rollback) store.undo();
    expect(store.document.getTileset(bank.id)?.generated).toEqual(generated);
    expect(store.document.getTileset(bank.id)?.group).toBeUndefined();
    if (rollback) expect(store.historyEntries()).toEqual(history);
    while (store.undo()) expect(store.document.getTileset(bank.id)?.generated).toEqual(generated);
    const before = serializeProject({ name: "P", levels: [], tilesets: store.document.tilesets });
    while (store.redo()) {
      const live = store.document.getTileset(bank.id);
      if (live) expect(live.generated).toEqual(generated);
    }
    while (store.undo()) { /* original document plus current cache provenance */ }
    expect(serializeProject({ name: "P", levels: [], tilesets: store.document.tilesets })).toBe(before);
    expect(() => store.dispatch({ type: "setTilesetMeta", tilesetId: bank.id, name: "Wrong", generated, undoable: false })).toThrow(/cache refresh/);
  }), { numRuns: 35 });
});
