import { expect, it } from "vitest";
import { harness, success, error, tile } from "./helpers";
import { AGENT_LIMITS as L } from "../src/contracts";
import { memoryCall } from "../src/testing/memoryHost";
import { serializeLevel } from "@smap/core";

it("bounds sparse, grid and read payloads before dispatch while uniform tools may cover the whole map", async () => {
  const h = harness({ width: 256, height: 256 });
  await h.begin();
  const before = h.host.snapshot();
  error(
    await h.edit("paint_cells", {
      mapId: "map-1",
      layerId: "ground",
      cells: Array.from({ length: 4097 }, (_, i) => ({ x: i % 256, y: Math.floor(i / 256), value: tile })),
    }),
    "INVALID_ARGUMENT", // schema maxItems
  );
  error(
    await h.edit("paint_grid", {
      mapId: "map-1",
      layerId: "ground",
      rows: Array.from({ length: 128 }, () => "g".repeat(129)),
      legend: { g: tile },
    }),
    "LIMIT_EXCEEDED",
  );
  error(
    await h.edit("fill", {
      mapId: "map-1",
      layerId: "ground",
      start: { x: 0, y: 0 },
      value: tile,
      maxCells: 100,
    }),
    "LIMIT_EXCEEDED",
  );
  error(
    await h.read("read_region", {
      mapId: "map-1",
      region: { x: 0, y: 0, width: 129, height: 128 },
      layerIds: ["ground"],
    }),
    "LIMIT_EXCEEDED",
  );
  error(await h.read("read_region", { mapId: "map-1" }), "LIMIT_EXCEEDED");
  expect(h.host.snapshot()).toEqual(before);
  const rect = success(await h.edit("paint_rect", { mapId: "map-1", layerId: "ground", region: { x: 0, y: 0, width: 256, height: 128 }, value: tile }));
  expect(rect.changed).toBe(256 * 128);
  const filled = success(await h.edit("fill", { mapId: "map-1", layerId: "ground", start: { x: 0, y: 200 }, value: { ...tile, tileId: 1 } }));
  expect(filled.changed).toBe(256 * 128);
});
it("splitting calls cannot bypass the cumulative planned-write limit or mutation-call cap", async () => {
  const h = harness({ width: 64, height: 64 });
  await h.begin();
  for (let i = 0; i < L.transactionPlannedWrites / 4096; i++)
    success(
      await h.edit("paint_rect", {
        mapId: "map-1",
        layerId: "ground",
        region: { x: 0, y: 0, width: 64, height: 64 },
        value: tile,
      }),
    );
  const before = h.host.snapshot();
  error(
    await h.edit("paint_rect", {
      mapId: "map-1",
      layerId: "ground",
      region: { x: 0, y: 0, width: 1, height: 1 },
      value: null,
    }),
    "LIMIT_EXCEEDED",
  );
  expect(h.host.snapshot()).toEqual(before);
  await h.api.userAction("discard");
  const k = harness();
  await k.begin();
  for (let i = 0; i < L.mutationCalls; i++)
    success(
      await k.edit("paint_cells", {
        mapId: "map-1",
        layerId: "ground",
        cells: [{ x: 0, y: 0, value: null }],
      }),
    );
  error(
    await k.edit("edit_layer", {
      mapId: "map-1",
      action: "update",
      layerId: "ground",
      props: { name: "No room" },
    }),
    "LIMIT_EXCEEDED",
  );
  await k.api.userAction("approve");
  expect(k.host.history.undoDepth).toBe(0);
}, 60000);
it("source retained bytes and new layer counts are checked before publication", async () => {
  const h = harness();
  await h.begin();
  const prepare = h.host.smartSources.prepare;
  h.host.smartSources.prepare = async (a, c) => {
    const source = await prepare(a, c);
    source.retainedBytes = L.retainedBytes + 1;
    return source;
  };
  const before = h.host.snapshot();
  error(
    await h.edit("prepare_smart_source", {
      mapId: "map-1",
      source: {
        tilesetId: "tiles",
        region: { x: 0, y: 0, width: 3, height: 3 },
      },
      force: true,
    }),
    "LIMIT_EXCEEDED",
  );
  expect(h.host.snapshot()).toEqual(before);
  for (let i = 3; i < 128; i++)
    success(
      await h.edit("edit_layer", {
        mapId: "map-1",
        action: "create",
        kind: "tile",
        name: `Layer ${i}`,
      }),
    );
  error(
    await h.edit("edit_layer", {
      mapId: "map-1",
      action: "create",
      kind: "tile",
      name: "Too many",
    }),
    "LIMIT_EXCEEDED",
  );
});
it("map area and target-map counts have independent hard limits", async () => {
  const h = harness();
  await h.begin();
  error(
    await h.edit("resize_map", { mapId: "map-1", width: 4096, height: 4096 }),
    "LIMIT_EXCEEDED",
  );
  error(
    await h.edit("create_map", {
      name: "Huge",
      width: 4096,
      height: 4096,
      tileWidth: 32,
      tileHeight: 32,
    }),
    "LIMIT_EXCEEDED",
  );
  for (let i = 1; i < 8; i++)
    success(
      await h.edit("create_map", {
        name: `Map ${i}`,
        width: 4,
        height: 4,
        tileWidth: 32,
        tileHeight: 32,
      }),
    );
  const before = h.host.snapshot();
  error(
    await h.edit("create_map", {
      name: "Too many",
      width: 4,
      height: 4,
      tileWidth: 32,
      tileHeight: 32,
    }),
    "LIMIT_EXCEEDED",
  );
  expect(h.host.snapshot()).toEqual(before);
});
it("oversized host images and stale image encodes return errors without changing maps", async () => {
  const h = harness();
  h.host.images.renderPreview = async () => ({
    png: new Uint8Array(1),
    width: 2049,
    height: 1,
    revision: 0,
    warnings: [],
    region: { x: 0, y: 0, width: 1, height: 1 },
    mapRevision: 0,
    image: {
      width: 2049,
      height: 1,
      scale: 1,
      pixelOrigin: { x: 0, y: 0 },
      cellSize: { width: 32, height: 32 },
      contentRect: { x: 0, y: 0, width: 2049, height: 1 },
      grid: false,
      coordinates: false,
    },
  });
  const before = h.host.snapshot();
  error(await h.read("render_preview", { mapId: "map-1" }), "LIMIT_EXCEEDED");
  expect(h.host.snapshot()).toEqual(before);
});
it("queued calls are bounded per authenticated client", async () => {
  const h = harness();
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  const render = h.host.images.renderPreview;
  h.host.images.renderPreview = async (a, c) => {
    await promise;
    return render(a, c);
  };
  const calls = Array.from({ length: 32 }, () =>
    h.api.executeTool(
      memoryCall("render_preview", { context: h.context(), mapId: "map-1" }),
    ),
  );
  error(
    await h.api.executeTool(memoryCall("get_session", {})),
    "LIMIT_EXCEEDED",
  );
  resolve();
  for (const call of calls) success(await call);
});

it.each(["approve", "discard"] as const)("paints 4096 distinct tiles under the unchanged memory limit and restores exactly on %s", async action => {
  const h = harness({
    width: 64,
    height: 64,
    tilesets: [
      {
        id: "tiles",
        name: "Large",
        tileWidth: 1,
        tileHeight: 1,
        columns: 4096,
        rows: 1,
        margin: 0,
        spacing: 0,
        imagePath: "large.png",
      },
    ],
  });
  await h.begin();
  const before = h.host.snapshot();
  success(
    await h.edit("paint_cells", {
      mapId: "map-1",
      layerId: "ground",
      cells: Array.from({ length: 4096 }, (_, tileId) => ({
        x: tileId % 64,
        y: Math.floor(tileId / 64),
        value: { tilesetId: "tiles", tileId },
      })),
    }),
  );
  expect(L.retainedBytes).toBe(64 * 1024 * 1024);
  expect(h.api.getState().transaction!.counters).toMatchObject({
    plannedWrites: 4096,
    changedCells: 4096,
    retainedBytes: 4096 * (32 + 8 + 128 + "tiles".length * 2) + 64,
  });
  const store = h.host.stores.get("map-1")!;
  expect(store.document.palette.size).toBe(4096);
  const afterText = serializeLevel(store.document);
  await h.api.userAction(action);
  if (action === "discard") expect(h.host.snapshot()).toEqual(before);
  else {
    const snapshots = store.peekUndo()!.changes.filter(c => c.kind === "paletteAppend");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ before: [], after: expect.arrayContaining([{ tilesetId: "tiles", tileId: 4095 }]) });
    expect(h.host.history.undoDepth).toBe(1);
    h.host.history.undo();
    expect(store.document.palette.size).toBe(0);
    expect(store.document.getLayer("ground")!.chunkCount).toBe(0);
    h.host.history.redo();
    expect(serializeLevel(store.document)).toBe(afterText);
  }
});
