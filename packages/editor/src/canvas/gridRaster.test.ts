import {
  COLLISION_PASSABLE,
  COLLISION_SOLID,
  MapStore,
  chunkKey,
  collisionAt,
  createDocument,
  makeCell,
  type StoreChangeEvent,
} from "@smap/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { gridFillWrites, gridPaintValue, gridRectWrites, gridWrites } from "./gridPaint";
import {
  COLL_FORCED_PASSABLE,
  COLL_FORCED_SOLID,
  COLL_NONE,
  ChunkCache,
  collisionChunkRaster,
  collisionInvalidation,
  isSolidCode,
  solidEdges,
} from "./gridRaster";

const TILESET = { id: "ts", name: "T", imagePath: "t.png", tileWidth: 32, tileHeight: 32, columns: 4, rows: 4, margin: 0, spacing: 0 };

function setup(width = 40, height = 36) {
  const store = new MapStore(createDocument({ width, height }));
  store.dispatch({ type: "addTileset", tileset: TILESET });
  for (let t = 0; t < 4; t++) store.getOrAddPaletteIndex("ts", t);
  store.dispatch({ type: "addLayer", layer: { id: "ground", name: "G" } });
  store.dispatch({ type: "addLayer", layer: { id: "col", name: "C", type: "grid", role: "collision" } });
  store.dispatch({ type: "addLayer", layer: { id: "col2", name: "C2", type: "grid", role: "collision" } });
  store.clearHistory();
  return store;
}

function event(partial: Partial<StoreChangeEvent>): StoreChangeEvent {
  return { revision: 1, cause: "dispatch", cells: [], structure: [], historyChanged: false, ...partial } as StoreChangeEvent;
}

describe("grid paint helpers", () => {
  it("gridPaintValue: eraser writes 0, invalid values paint nothing", () => {
    expect(gridPaintValue("eraser", 7, 2)).toBe(0);
    expect(gridPaintValue("brush", 2, 2)).toBe(2);
    expect(gridPaintValue("fill", 3, 2)).toBeNull();
    expect(gridPaintValue("rect", 0, 0xffff)).toBeNull();
    expect(gridPaintValue("brush", 1.5, 0xffff)).toBeNull();
  });

  it("gridWrites skips out-of-bounds and unchanged cells", () => {
    const get = (x: number) => (x === 1 ? 5 : 0);
    expect(gridWrites([{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }], 5, { width: 3, height: 3 }, get)).toEqual([
      { x: 0, y: 0, value: 5 },
    ]);
  });

  it("gridRectWrites covers the rectangle minus cells that already hold the value", () => {
    const w = gridRectWrites({ x: 1, y: 1, width: 3, height: 2 }, 4, (x, y) => (x === 2 && y === 1 ? 4 : 0));
    expect(w).toHaveLength(5);
    expect(w).not.toContainEqual({ x: 2, y: 1, value: 4 });
  });

  it("gridFillWrites floods the 4-connected region of equal grid values", () => {
    const store = setup(8, 6);
    // A ring of 1s around (3,3) .. a hole of 0 inside.
    const ring = [];
    for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) if (x === 1 || x === 5 || y === 1 || y === 5) ring.push({ x, y: Math.min(y, 5), value: 1 });
    store.dispatch({ type: "paintGrid", layerId: "col", cells: ring.filter((c) => c.y < 6) });
    const layer = store.document.getLayer("col")!;
    const inside = gridFillWrites(layer, 3, 3, 2, store.document.map);
    expect(inside).toHaveLength(9);
    expect(inside.every((c) => c.x >= 2 && c.x <= 4 && c.y >= 2 && c.y <= 4 && c.value === 2)).toBe(true);
    expect(gridFillWrites(layer, 1, 1, 1, store.document.map)).toEqual([]); // same value
    expect(gridFillWrites(layer, 1, 1, 2, store.document.map)).toHaveLength(ring.length);
    expect(gridFillWrites(layer, 99, 1, 2, store.document.map)).toEqual([]);
  });
});

describe("collision chunk raster", () => {
  it("matches core collisionAt on random documents", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ x: fc.integer({ min: 0, max: 39 }), y: fc.integer({ min: 0, max: 35 }), v: fc.integer({ min: 0, max: 4 }) }), { maxLength: 80 }),
        fc.array(fc.record({ x: fc.integer({ min: 0, max: 39 }), y: fc.integer({ min: 0, max: 35 }), v: fc.integer({ min: 0, max: 2 }), top: fc.boolean() }), { maxLength: 60 }),
        (tiles, exceptions) => {
          const store = setup();
          store.dispatch({ type: "paintCells", layerId: "ground", cells: tiles.map((t) => ({ x: t.x, y: t.y, cell: t.v === 0 ? 0 : makeCell(t.v) })) });
          for (const top of [false, true]) {
            const cells = exceptions.filter((e) => e.top === top).map((e) => ({ x: e.x, y: e.y, value: e.v }));
            store.dispatch({ type: "paintGrid", layerId: top ? "col2" : "col", cells });
          }
          const doc = store.document;
          for (let cy = 0; cy <= 1; cy++) {
            for (let cx = 0; cx <= 1; cx++) {
              const r = collisionChunkRaster(doc, cx, cy);
              for (let i = 0; i < 1024; i++) {
                const x = cx * 32 + (i & 31);
                const y = cy * 32 + (i >> 5);
                expect(isSolidCode(r[i]!)).toBe(collisionAt(doc, x, y));
              }
            }
          }
        },
      ),
      { numRuns: 40 },
    );
  }, 60_000);

  it("codes reflect only manual blocked and passable cells", () => {
    const store = setup();

    store.dispatch({ type: "addLayer", layer: { id: "plain", name: "P" } });
    store.dispatch({ type: "paintCells", layerId: "plain", cells: [{ x: 0, y: 0, cell: makeCell(2) }, { x: 1, y: 0, cell: makeCell(2) }] });
    store.dispatch({ type: "paintGrid", layerId: "col", cells: [{ x: 1, y: 0, value: COLLISION_PASSABLE }, { x: 2, y: 0, value: COLLISION_SOLID }] });
    const r = collisionChunkRaster(store.document, 0, 0);
    expect([r[0], r[1], r[2], r[3]]).toEqual([COLL_NONE, COLL_FORCED_PASSABLE, COLL_FORCED_SOLID, COLL_NONE]);
  });

});

describe("manual collision overlay invalidation", () => {
  const isCollision = (id: string) => id.startsWith("col");
  it("only collision cell chunks invalidate; layer order and map resize invalidate everything", () => {
    expect(collisionInvalidation(event({cells:[{layerId:"ground",chunks:["0,0"]},{layerId:"col",chunks:["1,0"]}]}),isCollision)).toEqual({all:false,keys:["1,0"]});
    for (const s of ["layers","map"] as const) expect(collisionInvalidation(event({structure:[s]}),isCollision).all).toBe(true);
    expect(collisionInvalidation(event({structure:["palette"]}),isCollision)).toEqual({all:false,keys:[]});
  });
  it("paintGrid and undo invalidate the same chunks", () => {
    const store=setup(), seen: ReturnType<typeof collisionInvalidation>[]=[];
    store.subscribe(e => seen.push(collisionInvalidation(e,isCollision)));
    store.dispatch({type:"paintGrid",layerId:"col",cells:[{x:33,y:2,value:1}]});
    expect(seen.at(-1)).toEqual({all:false,keys:[chunkKey(1,0)]});
    store.undo(); expect(seen.at(-1)!.keys).toContain(chunkKey(1,0));
  });
});

describe("ChunkCache", () => {
  it("builds lazily, caches empty results and rebuilds only stale keys", () => {
    const cache = new ChunkCache<number>();
    let builds = 0;
    const build = (prev: number | undefined) => (builds++, (prev ?? 0) + 1);
    expect(cache.get("0,0", build)).toBe(1);
    expect(cache.get("0,0", build)).toBe(1);
    expect(builds).toBe(1);
    cache.invalidate({ all: false, keys: ["1,1", "0,0"] });
    expect(cache.isStale("1,1")).toBe(true); // never built
    expect(cache.get("0,0", build)).toBe(2);
    expect(builds).toBe(2);
    cache.get("2,2", build);
    cache.invalidate({ all: true, keys: [] });
    expect(cache.isStale("0,0") && cache.isStale("2,2")).toBe(true);
    expect(cache.get("2,2", build)).toBe(2);
    expect(cache.isStale("0,0")).toBe(true);
    const disposed: number[] = [];
    cache.clear((v) => disposed.push(v));
    expect(disposed.sort()).toEqual([2, 2]);
    expect(cache.size).toBe(0);
  });
});

describe("solidEdges", () => {
  const set = (cells: string[]) => {
    const s = new Set(cells);
    return (x: number, y: number) => s.has(`${x},${y}`);
  };

  it("outlines a 2×1 block with four merged runs", () => {
    const edges = solidEdges(0, 0, 5, 5, set(["1,1", "2,1"]));
    expect(edges).toHaveLength(4);
    expect(edges).toContainEqual({ horizontal: true, line: 1, from: 1, to: 3, inside: "after" });
    expect(edges).toContainEqual({ horizontal: true, line: 2, from: 1, to: 3, inside: "before" });
    expect(edges).toContainEqual({ horizontal: false, line: 1, from: 1, to: 2, inside: "after" });
    expect(edges).toContainEqual({ horizontal: false, line: 3, from: 1, to: 2, inside: "before" });
  });

  it("total edge length equals the perimeter for random shapes", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.tuple(fc.integer({ min: -1, max: 8 }), fc.integer({ min: -1, max: 8 })), { maxLength: 40 }), (pts) => {
        const at = set(pts.map(([x, y]) => `${x},${y}`));
        let perimeter = 0;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            // boundaries owned by the range: top/left of each cell, plus bottom row / right column
            if (at(x, y) !== at(x, y - 1)) perimeter++;
            if (at(x, y) !== at(x - 1, y)) perimeter++;
            if (y === 7 && at(x, y) !== at(x, y + 1)) perimeter++;
            if (x === 7 && at(x, y) !== at(x + 1, y)) perimeter++;
          }
        }
        const total = solidEdges(0, 0, 8, 8, at).reduce((n, e) => n + (e.to - e.from), 0);
        expect(total).toBe(perimeter);
      }),
    );
  });
});
