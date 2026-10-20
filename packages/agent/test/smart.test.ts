import { expect, it } from "vitest";
import {
  buildRoadProfile,
  createDocument,
  MapStore,
  nineSliceLayout,
  serializeLevel,
  type Stamp,
} from "@smap/core";
import { harness, success, error, tile } from "./helpers";

function bandFixture(band = 2) {
  const size = band * 2 + 1;
  const base: Stamp = {
    id: "road",
    name: "Road",
    width: size,
    height: size,
    palette: Array.from({ length: size * size }, (_, tileId) => ({
      tilesetId: "tiles",
      tileId,
    })),
    layers: [
      {
        layerId: "s",
        name: "Ground",
        cells: Uint32Array.from({ length: size * size }, (_, i) => i + 1),
      },
    ],
    nineSlice: {
      border: band,
      tileLayers: [{ layerId: "s", tilesetId: "baked" }],
    },
  };
  const stamp: Stamp = {
    ...base,
    nineSlice: {
      ...base.nineSlice!,
      road: { tilesetId: "baked", profile: buildRoadProfile(base, "s") },
    },
  };
  const tilesets = [
    {
      id: "tiles",
      name: "Tiles",
      tileWidth: 32,
      tileHeight: 32,
      columns: 8,
      rows: 8,
      margin: 0,
      spacing: 0,
      imagePath: "tiles.png",
    },
    {
      id: "baked",
      name: "Baked",
      tileWidth: 32,
      tileHeight: 32,
      columns: nineSliceLayout(stamp).slots,
      rows: 1,
      margin: 0,
      spacing: 0,
      imagePath: "baked.png",
    },
  ];
  const store = new MapStore(
    createDocument({ width: 16, height: 16, tilesets }),
  );
  store.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
  store.clearHistory();
  return harness({ maps: [{ id: "map-1", store }], stamps: [stamp], tilesets });
}
it("thick smart roads accept aligned macro top-lefts, expand whole bands and reject misaligned requests atomically", async () => {
  const h = bandFixture();
  await h.begin();
  const prepared = success(
    await h.edit("prepare_smart_source", {
      mapId: "map-1",
      source: { stampId: "road" },
    }),
  );
  const sourceId = "sourceId" in prepared.data ? prepared.data.sourceId : "";
  success(
    await h.edit("smart_brush", {
      mapId: "map-1",
      layerId: "ground",
      sourceId,
      mode: "road",
      cells: [
        { x: 4, y: 4 },
        { x: 6, y: 4 },
      ],
    }),
  );
  const store = h.host.stores.get("map-1")!,
    target = store.document.getLayer("ground")!;
  for (let y = 4; y < 6; y++)
    for (let x = 4; x < 8; x++) expect(target.getCell(x, y)).not.toBe(0);
  const before = h.host.snapshot();
  error(
    await h.edit("smart_brush", {
      mapId: "map-1",
      layerId: "ground",
      sourceId,
      mode: "road",
      cells: [{ x: 3, y: 4 }],
    }),
    "INVALID_ARGUMENT",
  );
  expect(h.host.snapshot()).toEqual(before);
  const path = success(
    await h.edit("draw_path", {
      mapId: "map-1",
      layerId: "ground",
      sourceId,
      kind: "path",
      points: [
        { x: 7, y: 7 },
        { x: 11, y: 11 },
      ],
      width: 2,
    }),
  );
  expect(path.data).toMatchObject({ widthInTiles: 4 });
});
it("smart source pixel changes invalidate the whole pending action before another planner can write", async () => {
  const h = harness(),
    before = h.host.snapshot();
  await h.begin();
  success(
    await h.edit("paint_cells", {
      mapId: "map-1",
      layerId: "ground",
      cells: [{ x: 0, y: 0, value: tile }],
    }),
  );
  const prepared = success(
      await h.edit("prepare_smart_source", {
        mapId: "map-1",
        source: {
          tilesetId: "tiles",
          region: { x: 0, y: 0, width: 3, height: 3 },
        },
        force: true,
      }),
    ),
    sourceId = "sourceId" in prepared.data ? prepared.data.sourceId : "";
  h.host.pixels.get(JSON.stringify(["tiles", 0]))![0] = 255;
  error(
    await h.edit("smart_brush", {
      mapId: "map-1",
      layerId: "ground",
      sourceId,
      mode: "road",
      cells: [{ x: 4, y: 4 }],
    }),
    "SOURCE_CHANGED",
  );
  expect(h.host.snapshot()).toEqual(before);
});
it("source preparation rejects native grid mismatch, missing IDs, unsuitable sources and out-of-sheet rectangles without mutation", async () => {
  const h = harness();
  await h.begin();
  const before = h.host.snapshot();
  error(
    await h.edit("prepare_smart_source", {
      mapId: "map-1",
      source: {
        tilesetId: "missing",
        region: { x: 0, y: 0, width: 3, height: 3 },
      },
    }),
    "UNKNOWN_ID",
  );
  error(
    await h.edit("prepare_smart_source", {
      mapId: "map-1",
      source: {
        tilesetId: "tiles",
        region: { x: 7, y: 7, width: 3, height: 3 },
      },
      force: true,
    }),
    "OUT_OF_BOUNDS",
  );
  error(
    await h.edit("prepare_smart_source", {
      mapId: "map-1",
      source: {
        tilesetId: "tiles",
        region: { x: 0, y: 0, width: 1, height: 1 },
      },
      force: true,
    }),
    "SOURCE_NOT_SMART",
  );
  expect(h.host.snapshot()).toEqual(before);
  success(
    await h.edit("create_map", {
      name: "Different grid",
      width: 8,
      height: 8,
      tileWidth: 16,
      tileHeight: 16,
    }),
  );
  const mapId = [...h.host.stores.keys()].find((id) => id !== "map-1")!;
  const beforeMismatch = h.host.snapshot();
  error(
    await h.edit("prepare_smart_source", {
      mapId,
      source: {
        tilesetId: "tiles",
        region: { x: 0, y: 0, width: 3, height: 3 },
      },
      force: true,
    }),
    "GRID_MISMATCH",
  );
  expect(h.host.snapshot()).toEqual(beforeMismatch);
});
it("smart repair halos are charged even when input membership fits the per-call limit", async () => {
  const h = harness({ width: 80, height: 80 });
  await h.begin();
  const prepared = success(
      await h.edit("prepare_smart_source", {
        mapId: "map-1",
        source: {
          tilesetId: "tiles",
          region: { x: 0, y: 0, width: 3, height: 3 },
        },
        force: true,
      }),
    ),
    sourceId = "sourceId" in prepared.data ? prepared.data.sourceId : "";
  success(
    await h.edit("smart_brush", {
      mapId: "map-1",
      layerId: "ground",
      sourceId,
      mode: "road",
      cells: Array.from({ length: 64 }, (_, x) => ({ x: x + 1, y: 1 })),
    }),
  );
  const before = serializeLevel(h.host.stores.get("map-1")!.document);
  error(
    await h.edit("smart_brush", {
      mapId: "map-1",
      layerId: "ground",
      sourceId,
      mode: "area",
      region: { x: 1, y: 2, width: 64, height: 64 },
    }),
    "LIMIT_EXCEEDED",
  );
  expect(serializeLevel(h.host.stores.get("map-1")!.document)).toBe(before);
});

it("approval rechecks prepared source fingerprints before committing any map", async () => {
  const h = harness(),
    before = h.host.snapshot();
  await h.begin();
  success(
    await h.edit("prepare_smart_source", {
      mapId: "map-1",
      source: {
        tilesetId: "tiles",
        region: { x: 0, y: 0, width: 3, height: 3 },
      },
      force: true,
    }),
  );
  h.host.pixels.get(JSON.stringify(["tiles", 0]))![0] = 255;
  await expect(h.api.userAction("approve")).rejects.toMatchObject({
    code: "SOURCE_CHANGED",
  });
  expect(h.host.snapshot()).toEqual(before);
  expect(h.host.transactions.writeGate.blocked).toBe(false);
});
