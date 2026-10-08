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
  serializeProject,
  terrainCandidates,
  isGridLayer,
  isTileLayer,
  LayerMergeError,
  moveRegion,
  SPAWN_TYPE_ID,
  type EntityFieldValue,
  type EntityType,
  type StoreChangeEvent,
} from "../src";
import { BLOB_ID, CORNER_ID, TERRAIN_TILESET, TILESET, derivedMismatches, makeStore, terrainArb } from "./helpers";

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

  it("steps keep a stable id while the depth shifts at the limit", () => {
    const { store, idx, layer } = limited(3);
    const ids: number[] = [];
    for (let x = 0; x < 3; x++) {
      store.dispatch({ type: "paintCells", layerId: layer, cells: [{ x, y: 0, cell: makeCell(idx) }] });
      ids.push(store.peekUndo()!.id);
    }
    expect(new Set(ids).size).toBe(3);
    expect(store.undoDepth).toBe(3);
    // At the limit a new step keeps the depth at 3: the depth no longer names the step, the id does.
    store.dispatch({ type: "paintCells", layerId: layer, cells: [{ x: 3, y: 0, cell: makeCell(idx) }] });
    expect(store.undoDepth).toBe(3);
    expect(store.peekUndo()!.id).not.toBe(ids[2]);
    store.undo();
    expect(store.peekUndo()!.id).toBe(ids[2]);
    expect(store.peekRedo()!.id).not.toBe(ids[2]);
    store.redo();
    expect(store.peekRedo()).toBeUndefined();
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
/** [tileWidth, tileHeight, margin, spacing] for `updateTilesetGrid`. */
const GRID_SPECS: readonly (readonly [number, number, number, number])[] = [
  [32, 32, 0, 0],
  [16, 16, 0, 0],
  [32, 32, 0, 1],
  [64, 64, 0, 0],
  [16, 32, 0, 0],
  [32, 32, 32, 0],
];
/** Original image sizes, and image sizes for `replaceTilesetImage` (same, shorter, wider, narrower + taller). */
const IMAGE_SIZES: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  grass: [[256, 256], [256, 192], [320, 256], [192, 288]],
  terrain: [[384, 320], [384, 256], [448, 320], [320, 352]],
};
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
  // v0.3 ops
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("terrain" as const),
      layer: pick,
      dabs: fc.array(
        fc.array(fc.record({ x: coord, y: coord, value: fc.constantFrom(0, BLOB_ID, CORNER_ID, 3, 2) }), { minLength: 1, maxLength: 6 }),
        { minLength: 1, maxLength: 4 },
      ),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("solid" as const),
      tileset: fc.constantFrom("grass", "terrain"),
      tileIds: fc.array(fc.nat({ max: 63 }), { maxLength: 4 }),
      solid: fc.boolean(),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("defineTerrain" as const), terrain: terrainArb() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("removeTerrain" as const), id: fc.constantFrom(1, 2, 3) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("addGrid" as const), index: pick, target: pick }) },
  // Tileset grid edits (re-slice / resized PNG): palette, solid flags and terrains are remapped.
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("tilesetGrid" as const),
      tileset: fc.constantFrom("grass", "terrain"),
      spec: fc.nat({ max: GRID_SPECS.length - 1 }),
      withImage: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("tilesetImage" as const),
      tileset: fc.constantFrom("grass", "terrain"),
      size: fc.nat({ max: 3 }),
    }),
  },
  // v0.6 entity ops
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("addEntity" as const),
      layer: pick,
      type: pick,
      x: coord,
      y: coord,
      dx: fc.constantFrom(0, 5, 31),
      n: fc.integer({ min: -3, max: 9 }),
      index: pick,
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("removeEntity" as const), entity: pick }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("moveEntity" as const),
      entity: pick,
      path: fc.array(fc.record({ x: coord, y: coord }), { minLength: 1, maxLength: 4 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("updateEntity" as const),
      entity: pick,
      field: pick,
      n: fc.integer({ min: 0, max: 9 }),
      width: fc.constantFrom(undefined, null, 16, 64),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("defineEntityType" as const), variant: fc.nat({ max: 3 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("removeEntityType" as const), id: fc.constantFrom("chest", "npc") }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("addEntityLayer" as const), index: pick }) },
  // Round 3: tileset list / metadata, layer duplicate / merge, selection move.
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("removeTileset" as const), tileset: fc.constantFrom("grass", "terrain") }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("addTileset" as const), tileset: fc.constantFrom("grass", "terrain") }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("tilesetMeta" as const),
      tileset: fc.constantFrom("grass", "terrain"),
      name: fc.constantFrom(undefined, "Çimen", "Grass"),
      group: fc.constantFrom(undefined, null, "", "Dış", "Zindan"),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("moveTileset" as const), tileset: fc.constantFrom("grass", "terrain"), index: pick }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("duplicateLayer" as const), layer: pick }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("mergeLayerDown" as const), layer: pick }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("moveRegion" as const),
      layers: fc.array(pick, { minLength: 1, maxLength: 3 }),
      x: coord, y: coord, w: fc.integer({ min: 1, max: 6 }), h: fc.integer({ min: 1, max: 6 }),
      dx: fc.integer({ min: -4, max: 4 }), dy: fc.integer({ min: -4, max: 4 }),
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

const CHEST: EntityType = {
  id: "chest",
  name: "Chest",
  color: "#aa5500",
  fields: [
    { name: "count", type: "int", default: 1 },
    { name: "kind", type: "enum", default: "wood", enumValues: ["wood", "gold"] },
  ],
};

/** Entity type variants the property test defines. */
const TYPE_VARIANTS: readonly EntityType[] = [
  { ...CHEST, name: "Sandık" },
  { ...CHEST, fields: [{ name: "count", type: "int", default: 3 }] },
  { id: "npc", name: "NPC", color: "#3366ff", icon: "user", fields: [{ name: "line", type: "string", default: "" }, { name: "home", type: "point", default: null }] },
  { id: "npc", name: "NPC", color: "#3366ff", fields: [{ name: "speed", type: "float", default: 1.5 }, { name: "to", type: "levelRef", default: null }, { name: "boss", type: "bool", default: false }] },
];

function fieldValue(type: string, n: number, enumValues: readonly string[] = []): EntityFieldValue {
  switch (type) {
    case "int": return n;
    case "float": return n / 4;
    case "bool": return n % 2 === 0;
    case "enum": return enumValues[n % enumValues.length]!;
    case "levelRef": return n % 3 === 0 ? null : `lvl-${n}`;
    case "point": return n % 3 === 0 ? null : { x: n * 32, y: n };
    default: return `s${n}`;
  }
}

function allEntities(store: MapStore) {
  return store.document.entityLayers().flatMap((l) => l.entities);
}

function setup(): MapStore {
  const { store } = makeStore(W0, H0, PALETTE);
  // v0.6: an entity type, an entity layer with a chest and the spawn point.
  store.dispatch({ type: "defineEntityType", entityType: CHEST });
  store.dispatch({ type: "addLayer", layer: { id: "ents", name: "Entities", type: "entity" } });
  store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "c1", typeId: "chest", x: 64, y: 32, fields: { count: 4 } } });
  store.dispatch({ type: "addEntity", layerId: "ents", entity: { typeId: SPAWN_TYPE_ID, x: 0, y: 0 } });
  // v0.3: a terrain tileset, a terrain grid deriving into "top", a collision grid.
  // Every terrain tile is in the palette up front: palette entries are
  // append-only (not undoable), so derivation never grows it during the test.
  store.dispatch({ type: "addTileset", tileset: TERRAIN_TILESET });
  for (let t = 0; t < 120; t++) store.getOrAddPaletteIndex("terrain", t);
  store.dispatch({ type: "defineTerrain", terrain: { id: BLOB_ID, name: "G", tilesetId: "terrain", template: "blob47", origin: { col: 0, row: 0 } } });
  store.dispatch({ type: "defineTerrain", terrain: { id: CORNER_ID, name: "S", tilesetId: "terrain", template: "corner16", origin: { col: 8, row: 0 } } });
  store.dispatch({ type: "addLayer", layer: { id: "terr", name: "Terrain", type: "grid", role: "terrain", targetLayerId: "top" } });
  store.dispatch({ type: "addLayer", layer: { id: "col", name: "Collision", type: "grid", role: "collision" } });
  store.dispatch({ type: "paintTerrain", layerId: "terr", cells: [{ x: 8, y: 8, value: BLOB_ID }, { x: 9, y: 8, value: CORNER_ID }] });
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

function tileLayerAt(store: MapStore, n: number): string | undefined {
  const layers = store.document.layers.filter((l) => isTileLayer(l));
  return layers.length === 0 ? undefined : layers[n % layers.length]!.id;
}

function gridLayerAt(store: MapStore, n: number): string | undefined {
  const layers = store.document.layers.filter((l) => isGridLayer(l));
  return layers.length === 0 ? undefined : layers[n % layers.length]!.id;
}

/** Level and project bytes (tileset metadata lives in the project file). */
function snap(store: MapStore): string {
  return (
    serializeLevel(store.document) +
    serializeProject({ name: "p", levels: [], tilesets: store.document.tilesets, entityTypes: store.document.entityTypes })
  );
}

function layerSet(store: MapStore, picks: readonly number[]): string[] {
  return [...new Set(picks.map((p) => layerAt(store, p)).filter((id): id is string => id !== undefined))];
}

function applyEdit(store: MapStore, a: EditAction): void {
  const doc = store.document;
  switch (a.kind) {
    case "stroke": {
      const layerId = tileLayerAt(store, a.layer);
      if (!layerId) return;
      store.beginTransaction();
      for (const cells of a.dabs) store.dispatch({ type: "paintCells", layerId, cells });
      store.commit();
      return;
    }
    case "fill": {
      const layerId = tileLayerAt(store, a.layer);
      if (!layerId) return;
      const points = floodFill(doc.getLayer(layerId)!, a.x, a.y, a.cell, doc.map);
      store.dispatch({ type: "paintCells", layerId, cells: points.map((p) => ({ ...p, cell: a.cell })) });
      return;
    }
    case "rect": {
      const layerId = tileLayerAt(store, a.layer);
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
      // Cells may still use palette entries of a removed tileset: pasteClip refuses those clips (before any write).
      if (clip.palette.some((e) => !doc.getTileset(e.tilesetId))) return;
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
    case "terrain": {
      const layerId = gridLayerAt(store, a.layer);
      if (!layerId) return;
      const grid = doc.getGridLayer(layerId)!;
      store.beginTransaction();
      for (const cells of a.dabs) {
        store.dispatch({ type: "paintTerrain", layerId, cells: cells.map((c) => ({ ...c, value: Math.min(c.value, grid.maxValue) })) });
      }
      store.commit();
      return;
    }
    case "solid": {
      // Tileset grids may have changed: only ids inside the current grid.
      const ts = doc.getTileset(a.tileset);
      if (!ts) return;
      const tileIds = a.tileIds.filter((id) => id < ts.columns * ts.rows);
      store.dispatch({ type: "setTileSolid", tilesetId: a.tileset, tileIds, solid: a.solid });
      return;
    }
    case "defineTerrain": {
      // Only on the original grid, and only when every tile of the terrain is
      // already in the palette (palette growth is not undoable; see setup()).
      const ts = doc.getTileset("terrain");
      if (!ts) return;
      if (ts.columns !== 12 || ts.rows !== 10 || ts.tileWidth !== 32 || ts.tileHeight !== 32 || ts.margin !== 0 || ts.spacing !== 0) return;
      const tiles = terrainCandidates(ts, a.terrain).flat();
      if (tiles.some((id) => doc.palette.indexOf("terrain", id) === 0)) return;
      store.dispatch({ type: "defineTerrain", terrain: a.terrain });
      return;
    }
    case "tilesetGrid": {
      if (!doc.getTileset(a.tileset)) return;
      const [tileWidth, tileHeight, margin, spacing] = GRID_SPECS[a.spec]!;
      const [imageWidth, imageHeight] = IMAGE_SIZES[a.tileset]![0]!;
      store.dispatch({
        type: "updateTilesetGrid",
        tilesetId: a.tileset,
        tileWidth,
        tileHeight,
        margin,
        spacing,
        ...(a.withImage ? { imageWidth, imageHeight } : {}),
      });
      return;
    }
    case "tilesetImage": {
      if (!doc.getTileset(a.tileset)) return;
      const [imageWidth, imageHeight] = IMAGE_SIZES[a.tileset]![a.size]!;
      store.dispatch({ type: "replaceTilesetImage", tilesetId: a.tileset, imageWidth, imageHeight });
      return;
    }
    case "removeTerrain":
      if (doc.getTerrain(a.id)) store.dispatch({ type: "removeTerrain", terrainId: a.id });
      return;
    case "addGrid": {
      const target = tileLayerAt(store, a.target);
      const free = target !== undefined && !doc.layers.some((l) => isGridLayer(l) && l.targetLayerId === target);
      const index = a.index % (doc.layers.length + 1);
      if (free) store.dispatch({ type: "addLayer", layer: { name: "T", type: "grid", role: "terrain", targetLayerId: target }, index });
      else store.dispatch({ type: "addLayer", layer: { name: "C", type: "grid", role: "collision" }, index });
      return;
    }
    case "addEntityLayer":
      store.dispatch({ type: "addLayer", layer: { name: "E", type: "entity" }, index: a.index % (doc.layers.length + 1) });
      return;
    case "addEntity": {
      const layers = doc.entityLayers();
      if (layers.length === 0) return;
      const layer = layers[a.layer % layers.length]!;
      const types = doc.allEntityTypes();
      const type = types[a.type % types.length]!;
      if (type.id === SPAWN_TYPE_ID && doc.spawn()) return;
      const { tileWidth, tileHeight } = doc.map;
      const x = a.x * tileWidth + a.dx;
      const y = a.y * tileHeight;
      if (!doc.inBounds(Math.floor(x / tileWidth), Math.floor(y / tileHeight))) return;
      const first = type.fields[0];
      const fields = first && a.n >= 0 ? { [first.name]: fieldValue(first.type, a.n, first.enumValues) } : {};
      store.dispatch({ type: "addEntity", layerId: layer.id, entity: { typeId: type.id, x, y, fields }, index: a.index % (layer.entities.length + 1) });
      return;
    }
    case "removeEntity": {
      const all = allEntities(store);
      if (all.length > 0) store.dispatch({ type: "removeEntity", entityId: all[a.entity % all.length]!.id });
      return;
    }
    case "moveEntity": {
      const all = allEntities(store);
      if (all.length === 0) return;
      const id = all[a.entity % all.length]!.id;
      // A drag: one transaction, consecutive moves merge into one change.
      store.beginTransaction();
      for (const p of a.path) {
        if (doc.inBounds(p.x, p.y)) store.dispatch({ type: "moveEntity", entityId: id, x: p.x * doc.map.tileWidth, y: p.y * doc.map.tileHeight });
      }
      store.commit();
      return;
    }
    case "updateEntity": {
      const all = allEntities(store);
      if (all.length === 0) return;
      const entity = all[a.entity % all.length]!;
      const type = doc.getEntityType(entity.typeId);
      if (!type) return;
      const field = type.fields.length > 0 ? type.fields[a.field % type.fields.length]! : undefined;
      store.dispatch({
        type: "updateEntity",
        entityId: entity.id,
        ...(field ? { fields: { [field.name]: fieldValue(field.type, a.n, field.enumValues) } } : {}),
        ...(a.width !== undefined ? { width: a.width } : {}),
      });
      return;
    }
    case "defineEntityType":
      store.dispatch({ type: "defineEntityType", entityType: TYPE_VARIANTS[a.variant]! });
      return;
    case "removeEntityType":
      if (doc.entityTypes.some((t) => t.id === a.id)) store.dispatch({ type: "removeEntityType", typeId: a.id });
      return;
    case "removeTileset":
      if (doc.getTileset(a.tileset)) store.dispatch({ type: "removeTileset", tilesetId: a.tileset });
      return;
    case "addTileset":
      if (!doc.getTileset(a.tileset)) store.dispatch({ type: "addTileset", tileset: a.tileset === "grass" ? TILESET : TERRAIN_TILESET });
      return;
    case "tilesetMeta":
      if (doc.getTileset(a.tileset)) {
        store.dispatch({
          type: "setTilesetMeta",
          tilesetId: a.tileset,
          ...(a.name !== undefined ? { name: a.name } : {}),
          ...(a.group !== undefined ? { group: a.group } : {}),
        });
      }
      return;
    case "moveTileset":
      if (doc.getTileset(a.tileset)) store.dispatch({ type: "moveTileset", tilesetId: a.tileset, index: a.index % doc.tilesets.length });
      return;
    case "duplicateLayer": {
      const layerId = layerAt(store, a.layer);
      if (layerId) store.dispatch({ type: "duplicateLayer", layerId });
      return;
    }
    case "mergeLayerDown": {
      const layerId = layerAt(store, a.layer);
      if (!layerId) return;
      try {
        store.dispatch({ type: "mergeLayerDown", layerId });
      } catch (error) {
        if (!(error instanceof LayerMergeError)) throw error;
      }
      return;
    }
    case "moveRegion": {
      const ids = layerSet(store, a.layers);
      if (ids.length === 0) return;
      moveRegion(store, ids, { x: a.x, y: a.y, width: a.w, height: a.h }, a.dx, a.dy);
      return;
    }
  }
}

describe("v0.2/v0.3/v0.6 Bitti: random op sequences (incl. terrain, solid, terrain definitions, entities, entity types, tileset grid edits, tileset add/remove/move/meta, layer duplicate/merge, region move) are fully reversible", () => {
  it("undo all → initial bytes, redo all → final bytes; every state roundtrips; matches a snapshot model", () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 60 }).map((steps) => steps.flat().slice(0, 60)), (actions) => {
        const store = setup();
        const initial = snap(store);
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
            const before = snap(store);
            applyEdit(store, a);
            i++;
            const now = snap(store);
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
          expect(snap(store)).toBe(states[at]);
          // Invariant: every derived tile layer equals the from-scratch derivation of its terrain grid.
          expect(derivedMismatches(store.document)).toEqual([]);
          const text = serializeLevel(store.document);
          expect(serializeLevel(parseLevel(text, store.document.tilesets, store.document.entityTypes))).toBe(text);
        }

        const final = snap(store);
        while (store.undo());
        expect(snap(store)).toBe(initial);
        while (store.redo());
        expect(snap(store)).toBe(states[states.length - 1]);
        if (at === states.length - 1) expect(snap(store)).toBe(final);
      }),
      { numRuns: 300 },
    );
  }, 60_000);

  it("grouped transactions are single steps in the same model", () => {
    fc.assert(
      fc.property(fc.array(fc.array(editArb, { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 12 }), (groups) => {
        const store = setup();
        const states = [snap(store)];
        for (const group of groups) {
          const depth = store.undoDepth;
          store.beginTransaction();
          for (const a of group) applyEdit(store, a);
          store.commit();
          expect(store.undoDepth - depth).toBeLessThanOrEqual(1);
          expect(derivedMismatches(store.document)).toEqual([]);
          if (store.undoDepth > depth) states.push(snap(store));
        }
        for (let s = states.length - 2; s >= 0; s--) {
          expect(store.undo()).toBe(true);
          expect(snap(store)).toBe(states[s]);
        }
        expect(store.undo()).toBe(false);
        for (let s = 1; s < states.length; s++) {
          expect(store.redo()).toBe(true);
          expect(snap(store)).toBe(states[s]);
        }
      }),
      { numRuns: 150 },
    );
  }, 60_000);
});
