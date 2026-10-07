import { describe, expect, it } from "vitest";
import {
  COLLISION_PASSABLE,
  COLLISION_SOLID,
  FLIP_H,
  collisionAt,
  deriveCollision,
  makeCell,
  serializeProject,
  parseProject,
  type StoreChangeEvent,
} from "../src";
import { makeStore } from "./helpers";

function setup() {
  const { store, ground, top } = makeStore(40, 40, 6); // palette i → grass tile i-1
  store.dispatch({ type: "addLayer", layer: { id: "col", name: "Collision", type: "grid", role: "collision" } });
  store.clearHistory();
  return { store, ground, top };
}

function solidCells(store: ReturnType<typeof setup>["store"]): string[] {
  const grid = deriveCollision(store.document);
  const out: string[] = [];
  for (let i = 0; i < grid.data.length; i++) if (grid.data[i]) out.push(`${i % grid.width},${Math.floor(i / grid.width)}`);
  // collisionAt agrees with the bulk derivation everywhere
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) expect(collisionAt(store.document, x, y)).toBe(grid.data[y * grid.width + x] === 1);
  }
  return out;
}

describe("collision derivation", () => {
  it("solid tiles on any tile layer (hidden too, flips ignored) become solid", () => {
    const { store, ground, top } = setup();
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 1, y: 1, cell: makeCell(3) }, { x: 2, y: 1, cell: makeCell(2) }] });
    store.dispatch({ type: "paintCells", layerId: top, cells: [{ x: 35, y: 35, cell: makeCell(3, FLIP_H) }] });
    expect(solidCells(store)).toEqual([]);
    store.dispatch({ type: "setTileSolid", tilesetId: "grass", tileIds: [2], solid: true }); // palette 3
    expect(solidCells(store)).toEqual(["1,1", "35,35"]);
    store.dispatch({ type: "setLayerProps", layerId: top, props: { visible: false } });
    expect(solidCells(store)).toEqual(["1,1", "35,35"]);
    expect(collisionAt(store.document, -1, 0)).toBe(false);
  });

  it("collision layer exceptions override: 1 = force solid, 2 = force passable; topmost layer wins", () => {
    const { store, ground } = setup();
    store.dispatch({ type: "setTileSolid", tilesetId: "grass", tileIds: [0], solid: true });
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 5, y: 5, cell: makeCell(1) }, { x: 6, y: 5, cell: makeCell(1) }] });
    store.dispatch({
      type: "paintTerrain",
      layerId: "col",
      cells: [{ x: 6, y: 5, value: COLLISION_PASSABLE }, { x: 10, y: 10, value: COLLISION_SOLID }],
    });
    expect(solidCells(store)).toEqual(["5,5", "10,10"]);
    store.dispatch({ type: "addLayer", layer: { id: "col2", name: "C2", type: "grid", role: "collision" } });
    store.dispatch({ type: "paintTerrain", layerId: "col2", cells: [{ x: 10, y: 10, value: COLLISION_PASSABLE }, { x: 6, y: 5, value: COLLISION_SOLID }] });
    expect(solidCells(store)).toEqual(["5,5", "6,5"]);
    expect(() => store.dispatch({ type: "paintTerrain", layerId: "col", cells: [{ x: 0, y: 0, value: 3 }] })).toThrow(RangeError);
  });

  it("setTileSolid is undoable, emits 'tilesets', and persists in the project file", () => {
    const { store, ground } = setup();
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: makeCell(4) }] });
    const events: StoreChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    store.dispatch({ type: "setTileSolid", tilesetId: "grass", tileIds: [3, 1, 3], solid: true });
    expect(events.at(-1)).toMatchObject({ structure: ["tilesets"], historyChanged: true });
    expect(store.document.getTileset("grass")!.solidTiles).toEqual([1, 3]);
    const undoDepth = store.undoDepth;
    store.dispatch({ type: "setTileSolid", tilesetId: "grass", tileIds: [1], solid: true }); // no-op
    expect(store.undoDepth).toBe(undoDepth);
    expect(collisionAt(store.document, 0, 0)).toBe(true);

    const text = serializeProject({ name: "p", levels: [], tilesets: store.document.tilesets });
    expect(parseProject(text).tilesets[0]!.solidTiles).toEqual([1, 3]);
    expect(serializeProject(parseProject(text))).toBe(text);

    store.undo();
    expect(events.at(-1)).toMatchObject({ cause: "undo", structure: ["tilesets"] });
    expect(store.document.getTileset("grass")!.solidTiles).toBeUndefined();
    expect(collisionAt(store.document, 0, 0)).toBe(false);
    expect(() => store.dispatch({ type: "setTileSolid", tilesetId: "grass", tileIds: [64], solid: true })).toThrow(RangeError);
    expect(() => store.dispatch({ type: "setTileSolid", tilesetId: "x", tileIds: [], solid: true })).toThrow(/unknown tileset/);
  });
});
