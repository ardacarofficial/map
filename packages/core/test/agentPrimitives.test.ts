import { describe, expect, it } from "vitest";
import {
  createDocument,
  layerDrawList,
  regionDrawList,
  MapStore,
  serializeLevel,
  WorldHistory,
} from "../src";

function setup() {
  const store = new MapStore(
    createDocument({
      width: 8,
      height: 8,
      tilesets: [
        {
          id: "tiles",
          name: "Tiles",
          tileWidth: 16,
          tileHeight: 48,
          columns: 2,
          rows: 1,
          margin: 0,
          spacing: 0,
          imagePath: "tiles.png",
        },
      ],
    }),
  );
  const layerId = store.dispatch({
    type: "addLayer",
    layer: { name: "Ground" },
  });
  store.getOrAddPaletteIndex("tiles", 0);
  store.clearHistory();
  return { store, layerId };
}

describe("synchronous edit lease", () => {
  it("blocks every mutation entry while leased and restores authority after throws/release", () => {
    const { store, layerId } = setup();
    const lease = store.acquireEditLease({});
    const write = () =>
      store.dispatch({
        type: "paintCells",
        layerId,
        cells: [{ x: 0, y: 0, cell: 1 }],
      });
    for (const mutate of [
      write,
      () => store.beginTransaction(),
      () => store.commit(),
      () => store.rollback(),
      () => store.undo(),
      () => store.redo(),
      () => store.clearHistory(),
      () => store.clearRedo(),
      () => store.syncProjectData(store.document),
      () => store.undoTo(1),
      () => store.redoTo(1),
    ])
      expect(mutate).toThrow(/lease/);
    expect(() => store.acquireEditLease({})).toThrow(/lease/);
    expect(() =>
      lease.run(() => {
        throw new Error("scope");
      }),
    ).toThrow("scope");
    expect(write).toThrow(/lease/);
    lease.run(() => {
      store.beginTransaction();
      write();
      expect(store.transactionDepth).toBe(1);
      store.beginTransaction();
      expect(store.transactionDepth).toBe(2);
      store.commit();
      store.rollback();
    });
    expect(store.document.getLayer(layerId)!.getCell(0, 0)).toBe(0);
    // Runtime protection also applies to untyped callers.
    expect(() =>
      (lease.run as (f: () => unknown) => unknown)(() => Promise.resolve()),
    ).toThrow(/synchronous/);
    lease.release();
    write();
    expect(store.canUndo).toBe(true);
    expect(() => lease.run(write)).toThrow(/released/);
  });
});

describe("long-lived pending world history", () => {
  it("cancel and empty finish preserve a previous redo tail exactly", () => {
    const { store, layerId } = setup(),
      history = new WorldHistory();
    history.register("map", store);
    store.dispatch({
      type: "paintCells",
      layerId,
      cells: [{ x: 0, y: 0, cell: 1 }],
    });
    history.undo();
    const before = serializeLevel(store.document),
      rows = history.entries();
    const pending = history.beginPending("map", "AI");
    store.beginTransaction();
    store.dispatch({
      type: "paintCells",
      layerId,
      cells: [{ x: 2, y: 2, cell: 1 }],
    });
    expect(history.busy).toBe(true);
    expect(history.undo()).toBeNull();
    pending.cancel(() => store.rollback());
    expect(serializeLevel(store.document)).toBe(before);
    expect(history.entries()).toEqual(rows);
    expect(history.canRedo).toBe(true);
    const empty = history.beginPending("map", "empty");
    store.beginTransaction();
    expect(empty.finish(() => store.commit())).toBeNull();
    expect(history.entries()).toEqual(rows);
  });
  it("groups maps and metadata, orders replay prerequisites, and tolerates observer exceptions", () => {
    const a = setup(),
      b = setup(),
      history = new WorldHistory();
    history.register("a", a.store);
    history.register("b", b.store);
    const before = [a, b].map((m) => serializeLevel(m.store.document)),
      order: string[] = [];
    const pending = history.beginPending("a", "AI request");
    for (const m of [a, b]) {
      m.store.beginTransaction();
      m.store.dispatch({
        type: "paintCells",
        layerId: m.layerId,
        cells: [{ x: 1, y: 1, cell: 1 }],
      });
    }
    history.subscribe(() => {
      throw new Error("world observer");
    });
    const row = pending.finish(
      () => {
        for (const m of [a, b]) m.store.commit();
      },
      {
        apply: (side) => {
          order.push(side);
        },
      },
    );
    expect(row!.item.label).toBe("AI request");
    expect(history.undoDepth).toBe(1);
    expect(row!.participants).toHaveLength(2);
    a.store.subscribe((e) => {
      if (e.cause === "undo" || e.cause === "redo") order.push(e.cause);
    });
    history.undo();
    expect([a, b].map((m) => serializeLevel(m.store.document))).toEqual(before);
    expect(order).toEqual(["undo", "before"]);
    history.redo();
    expect(order).toEqual(["undo", "before", "after", "redo"]);
  });
  it("supports metadata-only rows and rejects reusing a closed collector", () => {
    const { store } = setup(),
      history = new WorldHistory();
    history.register("a", store);
    let value = "after";
    const p = history.beginPending("a", "metadata");
    const row = p.finish(() => {}, {
      apply: (side) => {
        value = side;
      },
    });
    expect(row!.participants).toEqual([]);
    history.undo();
    expect(value).toBe("before");
    history.redo();
    expect(value).toBe("after");
    expect(() => p.finish(() => {})).toThrow();
  });
});

it("region draw list matches full-list cropping, including oversized tiles and diagonal flags", () => {
  const { store, layerId } = setup();
  store.dispatch({
    type: "paintCells",
    layerId,
    cells: [
      { x: 2, y: 3, cell: 1 },
      { x: 1, y: 2, cell: 0x20000001 },
      { x: 0, y: 0, cell: 1 },
    ],
  });
  const rect = { x: 2, y: 2, width: 2, height: 1 },
    full = layerDrawList(store.document),
    region = regionDrawList(store.document, rect);
  const px = { x: 64, y: 64, width: 64, height: 32 };
  expect(region.width).toBe(px.width);
  expect(region.height).toBe(px.height);
  expect(region.layers).toEqual(
    full.layers.map((l) => ({
      ...l,
      items: l.items
        .filter(
          (i) =>
            i.dest.x < px.x + px.width &&
            i.dest.y < px.y + px.height &&
            i.dest.x + i.dest.width > px.x &&
            i.dest.y + i.dest.height > px.y,
        )
        .map((i) => ({
          ...i,
          dest: { ...i.dest, x: i.dest.x - px.x, y: i.dest.y - px.y },
        })),
    })),
  );
  expect(() => regionDrawList(store.document, { ...rect, width: 8 })).toThrow();
});

it("region draw lists preserve full compositing order across chunk edges and every D4 orientation", () => {
  for (let flags = 0; flags < 8; flags++) {
    const store = new MapStore(
      createDocument({
        width: 70,
        height: 70,
        tileWidth: 16,
        tileHeight: 24,
        tilesets: [
          {
            id: "large",
            name: "Large",
            tileWidth: 97,
            tileHeight: 81,
            columns: 1,
            rows: 1,
            margin: 2,
            spacing: 1,
            imagePath: "large.png",
          },
          {
            id: "small",
            name: "Small",
            tileWidth: 8,
            tileHeight: 5,
            columns: 1,
            rows: 1,
            margin: 0,
            spacing: 0,
            imagePath: "small.png",
          },
        ],
      }),
    );
    const layerId = store.dispatch({
        type: "addLayer",
        layer: { name: "Art" },
      }),
      large = store.getOrAddPaletteIndex("large", 0),
      small = store.getOrAddPaletteIndex("small", 0);
    const raw =
      ((flags & 1 ? 0x80000000 : 0) |
        (flags & 2 ? 0x40000000 : 0) |
        (flags & 4 ? 0x20000000 : 0)) >>>
      0;
    store.dispatch({
      type: "paintCells",
      layerId,
      cells: Array.from({ length: 80 }, (_, i) => ({
        x: 27 + (i % 10),
        y: 29 + Math.floor(i / 10),
        cell: ((i % 2 ? large : small) | raw) >>> 0,
      })),
    });
    const full = layerDrawList(store.document),
      crop = { x: 32, y: 31, width: 2, height: 3 },
      out = regionDrawList(store.document, crop),
      px = crop.x * 16,
      py = crop.y * 24,
      w = crop.width * 16,
      h = crop.height * 24;
    expect(out.layers).toEqual(
      full.layers.map((l) => ({
        ...l,
        items: l.items
          .filter(
            (i) =>
              i.dest.x < px + w &&
              i.dest.x + i.dest.width > px &&
              i.dest.y < py + h &&
              i.dest.y + i.dest.height > py,
          )
          .map((i) => ({
            ...i,
            dest: { ...i.dest, x: i.dest.x - px, y: i.dest.y - py },
          })),
      })),
    );
  }
});

it("keeps project patches when ordinary followers attach to an approved pending row", () => {
  const a = setup(),
    b = setup(),
    history = new WorldHistory();
  history.register("a", a.store);
  history.register("b", b.store);
  let metadata = "after";
  const p = history.beginPending("a", "AI");
  a.store.beginTransaction();
  a.store.dispatch({
    type: "paintCells",
    layerId: a.layerId,
    cells: [{ x: 0, y: 0, cell: 1 }],
  });
  p.finish(() => a.store.commit(), {
    apply: (side) => {
      metadata = side;
    },
  });
  history.includeFollowers("a", () =>
    b.store.dispatch({
      type: "paintCells",
      layerId: b.layerId,
      cells: [{ x: 0, y: 0, cell: 1 }],
    }),
  );
  history.undo();
  expect(metadata).toBe("before");
  history.redo();
  expect(metadata).toBe("after");
});
