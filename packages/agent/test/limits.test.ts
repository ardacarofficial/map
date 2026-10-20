import { expect, it } from "vitest";
import { harness, success, error, tile } from "./helpers";
import { AGENT_LIMITS as L } from "../src/contracts";
import { memoryCall } from "../src/testing/memoryHost";

it("bounds read/paint/fill searches before dispatch, including each layer and aggregate reads", async () => {
  const h = harness({ width: 128, height: 128 });
  await h.begin();
  const before = h.host.snapshot();
  error(
    await h.edit("paint_rect", {
      mapId: "map-1",
      layerId: "ground",
      region: { x: 0, y: 0, width: 65, height: 64 },
      value: tile,
    }),
    "LIMIT_EXCEEDED",
  );
  error(
    await h.edit("fill", {
      mapId: "map-1",
      layerId: "ground",
      region: { x: 0, y: 0, width: 65, height: 64 },
      start: { x: 0, y: 0 },
      value: tile,
    }),
    "LIMIT_EXCEEDED",
  );
  error(
    await h.read("read_region", {
      mapId: "map-1",
      region: { x: 0, y: 0, width: 65, height: 64 },
      layerIds: ["ground"],
    }),
    "LIMIT_EXCEEDED",
  );
  expect(h.host.snapshot()).toEqual(before);
});
it("splitting calls cannot bypass the cumulative planned-write limit or mutation-call cap", async () => {
  const h = harness({ width: 64, height: 64 });
  await h.begin();
  for (let i = 0; i < 64; i++)
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
});
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

it("charges reversible palette snapshot growth before allocating a large batch", async () => {
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
  error(
    await h.edit("paint_cells", {
      mapId: "map-1",
      layerId: "ground",
      cells: Array.from({ length: 4096 }, (_, tileId) => ({
        x: tileId % 64,
        y: Math.floor(tileId / 64),
        value: { tilesetId: "tiles", tileId },
      })),
    }),
    "LIMIT_EXCEEDED",
  );
  expect(h.host.snapshot()).toEqual(before);
});
