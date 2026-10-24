import { describe, expect, it } from "vitest";
import {
  cellFlags,
  cellPaletteIndex,
  serializeLevel,
  FLIP_D,
} from "@smap/core";
import examples from "./fixtures/tool-examples.json";
import { harness, success, error, tile, stamp } from "./helpers";
import type { ToolName } from "../src/contracts";

const region = { x: 1, y: 1, width: 3, height: 2 };
it("get_session and get_map_info describe the open world and map without changing content", async () => {
  const h = harness(),
    before = h.host.snapshot();
  const s = success(await h.run("get_session", {}));
  expect(s.data).toMatchObject({ apiVersion: 1, activeMapId: "map-1" });
  const info = success(await h.read("get_map_info", { mapId: "map-1" }));
  expect(info.data).toMatchObject({
    map: { width: 16, height: 16 },
    layers: [
      { id: "ground", kind: "tile" },
      { id: "collision", kind: "collision" },
      { id: "entities", kind: "entity" },
    ],
  });
  expect(h.host.snapshot()).toEqual(before);
  error(await h.read("get_map_info", { mapId: "missing" }), "UNKNOWN_ID");
});
it("read_region decodes every compact orientation and collision values without palette integers", async () => {
  const h = harness();
  await h.begin();
  success(
    await h.edit("paint_cells", {
      mapId: "map-1",
      layerId: "ground",
      cells: Array.from({ length: 8 }, (_, flags) => ({
        x: flags,
        y: 0,
        value: { ...tile, flags },
      })),
    }),
  );
  success(
    await h.edit("paint_cells", {
      mapId: "map-1",
      layerId: "collision",
      cells: [{ x: 0, y: 0, value: { collision: 2 } }],
    }),
  );
  success(
    await h.edit("place_entity", {
      mapId: "map-1",
      layerId: "entities",
      typeId: "spawn",
      at: { x: 0, y: 0 },
    }),
  );
  const r = success(
    await h.read("read_region", {
      mapId: "map-1",
      region: { x: 0, y: 0, width: 8, height: 1 },
      layerIds: ["ground", "collision", "entities"],
      includeEntities: true,
      format: "cells",
    }),
  );
  expect(r.data).toMatchObject({
    legend: Array.from({ length: 8 }, (_, flags) => ({ ...tile, flags })),
    layers: [
      { cells: [1, 2, 3, 4, 5, 6, 7, 8] },
      { cells: [2, 0, 0, 0, 0, 0, 0, 0] },
      { kind: "entity" },
    ],
    entities: [{ typeId: "spawn", pixelX: 0, pixelY: 0 }],
  });
  error(
    await h.read("read_region", {
      mapId: "map-1",
      region: { x: 15, y: 0, width: 2, height: 1 },
      layerIds: ["ground"],
    }),
    "OUT_OF_BOUNDS",
  );
  error(
    await h.read("read_region", {
      mapId: "map-1",
      region,
      layerIds: ["missing"],
    }),
    "UNKNOWN_ID",
  );
});
it("catalog and stamp discovery return stable fingerprints, optional MCP PNGs, and no encoded image in JSON", async () => {
  const h = harness({ stamps: [stamp] });
  const sets = success(await h.read("list_tilesets"));
  expect(sets.data).toMatchObject({
    items: [{ id: "tiles", tileCount: 64, tagCounts: { missing: 64 } }],
  });
  const r = await h.read("get_tile_catalog", {
    tilesetId: "tiles",
    tileIds: [3, 0],
    image: "tiles",
  });
  success(r);
  expect(r.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
  expect(r.content[0].text).not.toContain("base64");
  const stamps = await h.read("list_stamps", { previewStampId: "house" });
  success(stamps);
  expect(stamps.content).toHaveLength(2);
  error(
    await h.read("get_tile_catalog", { tilesetId: "missing" }),
    "UNKNOWN_ID",
  );
  error(
    await h.read("get_tile_catalog", { tilesetId: "tiles", tileIds: [64] }),
    "UNKNOWN_ID",
  );
  error(
    await h.read("list_stamps", { previewStampId: "missing" }),
    "UNKNOWN_ID",
  );
});

describe("bounded painting", () => {
  it.each(["paint_cells", "paint_rect", "paint_line", "fill"] as const)(
    "%s changes map cells and rolls back exact palette bytes",
    async (tool) => {
      const h = harness(),
        before = h.host.snapshot();
      await h.begin();
      const args =
        tool === "paint_cells"
          ? { cells: [{ x: 1, y: 1, value: tile }] }
          : tool === "paint_rect"
            ? { region, value: tile }
            : tool === "paint_line"
              ? {
                  from: { x: 1, y: 1 },
                  to: { x: 3, y: 3 },
                  width: 2,
                  value: tile,
                }
              : { start: { x: 1, y: 1 }, region, value: tile };
      success(
        await h.edit(tool, { mapId: "map-1", layerId: "ground", ...args }),
      );
      expect(
        h.host.stores.get("map-1")!.document.getLayer("ground")!.getCell(1, 1),
      ).not.toBe(0);
      await h.api.userAction("discard");
      expect(h.host.snapshot()).toEqual(before);
    },
  );
  it("rectangle outlines preserve interior; even line widths expand right/down as documented", async () => {
    const h = harness();
    await h.begin();
    success(
      await h.edit("paint_rect", {
        mapId: "map-1",
        layerId: "ground",
        region: { x: 1, y: 1, width: 5, height: 5 },
        outline: 1,
        value: tile,
      }),
    );
    const layer = h.host.stores.get("map-1")!.document.getLayer("ground")!;
    expect(layer.getCell(3, 3)).toBe(0);
    expect(layer.getCell(5, 3)).not.toBe(0);
    success(
      await h.edit("paint_line", {
        mapId: "map-1",
        layerId: "ground",
        from: { x: 8, y: 8 },
        to: { x: 10, y: 8 },
        width: 2,
        value: tile,
      }),
    );
    expect(layer.getCell(8, 9)).not.toBe(0);
    expect(layer.getCell(8, 7)).toBe(0);
  });
  it("rejects duplicates, footprint overflow, wrong layer kinds, flags and fill excess without partial application", async () => {
    const h = harness();
    await h.begin();
    const before = h.host.snapshot();
    error(
      await h.edit("paint_cells", {
        mapId: "map-1",
        layerId: "ground",
        cells: [
          { x: 1, y: 1, value: tile },
          { x: 1, y: 1, value: null },
        ],
      }),
      "INVALID_ARGUMENT",
    );
    error(
      await h.edit("paint_line", {
        mapId: "map-1",
        layerId: "ground",
        from: { x: 15, y: 1 },
        to: { x: 15, y: 2 },
        width: 2,
        value: tile,
      }),
      "OUT_OF_BOUNDS",
    );
    error(
      await h.edit("paint_cells", {
        mapId: "map-1",
        layerId: "entities",
        cells: [{ x: 1, y: 1, value: tile }],
      }),
      "LAYER_KIND",
    );
    error(
      await h.edit("paint_rect", {
        mapId: "map-1",
        layerId: "collision",
        region,
        value: tile,
      }),
      "LAYER_KIND",
    );
    error(
      await h.edit("paint_rect", {
        mapId: "map-1",
        layerId: "ground",
        region,
        value: { ...tile, flags: 8 },
      }),
      "INVALID_ARGUMENT",
    );
    error(
      await h.edit("fill", {
        mapId: "map-1",
        layerId: "ground",
        start: { x: 1, y: 1 },
        region,
        value: tile,
        maxCells: 2,
      }),
      "LIMIT_EXCEEDED",
    );
    expect(h.host.snapshot()).toEqual(before);
  });
  it("bounded fill cannot escape its rectangle and no-op fill does not allocate a palette", async () => {
    const h = harness();
    await h.begin();
    success(
      await h.edit("fill", {
        mapId: "map-1",
        layerId: "ground",
        start: { x: 1, y: 1 },
        region,
        value: tile,
      }),
    );
    const store = h.host.stores.get("map-1")!;
    expect(store.document.getLayer("ground")!.getCell(0, 1)).toBe(0);
    const revision = store.revision;
    const again = success(
      await h.edit("fill", {
        mapId: "map-1",
        layerId: "ground",
        start: { x: 1, y: 1 },
        region,
        value: tile,
      }),
    );
    expect(again.data).toMatchObject({ filledCells: 0 });
    expect(store.revision).toBe(revision);
  });
});

it("edit_layer creates, reorders, updates, and enforces layer count and index limits", async () => {
  const h = harness(),
    before = h.host.snapshot();
  await h.begin();
  const created = success(
    await h.edit("edit_layer", {
      mapId: "map-1",
      action: "create",
      kind: "collision",
      name: "Walls",
      index: 1,
    }),
  );
  expect(created.data).toMatchObject({
    layer: { kind: "collision", index: 1 },
  });
  const id = h.host.stores.get("map-1")!.document.layers[1]!.id;
  success(
    await h.edit("edit_layer", {
      mapId: "map-1",
      action: "update",
      layerId: id,
      props: { name: "Blockers", opacity: 0.4 },
    }),
  );
  success(
    await h.edit("edit_layer", {
      mapId: "map-1",
      action: "reorder",
      layerId: id,
      index: 3,
    }),
  );
  error(
    await h.edit("edit_layer", {
      mapId: "map-1",
      action: "reorder",
      layerId: id,
      index: 4,
    }),
    "OUT_OF_BOUNDS",
  );
  error(
    await h.edit("edit_layer", {
      mapId: "map-1",
      action: "update",
      layerId: "missing",
      props: { visible: false },
    }),
    "UNKNOWN_ID",
  );
  await h.api.userAction("discard");
  expect(h.host.snapshot()).toEqual(before);
});
it("begin protection survives unlock/show and prevents indirect stamp and resize writes", async () => {
  const h = harness({ stamps: [stamp] }),
    store = h.host.stores.get("map-1")!;
  store.dispatch({
    type: "paintCells",
    layerId: "ground",
    cells: [{ x: 15, y: 15, cell: store.getOrAddPaletteIndex("tiles", 0) }],
  });
  store.dispatch({
    type: "setLayerProps",
    layerId: "ground",
    props: { locked: true, visible: false },
  });
  await h.begin();
  success(
    await h.edit("edit_layer", {
      mapId: "map-1",
      action: "update",
      layerId: "ground",
      props: { locked: false, visible: true },
    }),
  );
  const before = serializeLevel(store.document);
  error(
    await h.edit("paint_rect", {
      mapId: "map-1",
      layerId: "ground",
      region,
      value: tile,
    }),
    "LAYER_LOCKED",
  );
  error(
    await h.edit("place_stamp", {
      mapId: "map-1",
      stampId: "house",
      at: { x: 1, y: 1 },
    }),
    "LAYER_LOCKED",
  );
  error(
    await h.edit("resize_map", {
      mapId: "map-1",
      width: 8,
      height: 8,
      allowCrop: true,
    }),
    "LAYER_LOCKED",
  );
  expect(serializeLevel(store.document)).toBe(before);
  await h.api.userAction("discard");
});
it("place_stamp uses explicit mapping, transforms flags, and refuses clipping or ambiguous targets", async () => {
  const h = harness({ stamps: [stamp] });
  await h.begin();
  success(
    await h.edit("place_stamp", {
      mapId: "map-1",
      stampId: "house",
      at: { x: 1, y: 1 },
      rotation: 1,
      flipX: true,
      layerMapping: [{ sourceLayerId: "base", targetLayerId: "ground" }],
    }),
  );
  const store = h.host.stores.get("map-1")!,
    cell = store.document.getLayer("ground")!.getCell(1, 1);
  expect(store.document.palette.get(cellPaletteIndex(cell))).toEqual({
    tilesetId: "tiles",
    tileId: 4,
  });
  expect(cellFlags(cell)).toBe(FLIP_D);
  const before = h.host.snapshot();
  error(
    await h.edit("place_stamp", {
      mapId: "map-1",
      stampId: "house",
      at: { x: 15, y: 15 },
    }),
    "OUT_OF_BOUNDS",
  );
  error(
    await h.edit("place_stamp", {
      mapId: "map-1",
      stampId: "house",
      at: { x: 1, y: 1 },
      layerMapping: [],
    }),
    "STAMP_MAPPING_REQUIRED",
  );
  error(
    await h.edit("place_stamp", {
      mapId: "map-1",
      stampId: "house",
      at: { x: 1, y: 1 },
      layerMapping: [{ sourceLayerId: "base", targetLayerId: "collision" }],
    }),
    "LAYER_KIND",
  );
  expect(h.host.snapshot()).toEqual(before);
});
it("entity tools resolve defaults and reject invalid schema, duplicate spawn and portal targets", async () => {
  const type = {
    id: "npc",
    name: "NPC",
    color: "#ffffff",
    fields: [{ name: "health", type: "int" as const, default: 10 }],
  };
  const h = harness({ entityTypes: [type] });
  const types = success(await h.read("list_entity_types"));
  expect(types.data).toMatchObject({
    items: [{ id: "spawn" }, { id: "portal" }, { id: "npc" }],
  });
  await h.begin();
  const entity = success(
    await h.edit("place_entity", {
      mapId: "map-1",
      layerId: "entities",
      typeId: "npc",
      at: { x: 2, y: 3 },
    }),
  );
  expect(entity.data).toMatchObject({
    entity: { pixelX: 64, pixelY: 96, fields: { health: 10 } },
  });
  error(
    await h.edit("place_entity", {
      mapId: "map-1",
      layerId: "entities",
      typeId: "npc",
      at: { x: 2, y: 3 },
      fields: { health: "bad" },
    }),
    "ENTITY_SCHEMA",
  );
  error(
    await h.edit("place_entity", {
      mapId: "map-1",
      layerId: "entities",
      typeId: "portal",
      at: { x: 2, y: 3 },
      fields: { targetLevel: "missing" },
    }),
    "ENTITY_SCHEMA",
  );
  success(
    await h.edit("place_entity", {
      mapId: "map-1",
      layerId: "entities",
      typeId: "spawn",
      at: { x: 0, y: 0 },
    }),
  );
  error(
    await h.edit("place_entity", {
      mapId: "map-1",
      layerId: "entities",
      typeId: "spawn",
      at: { x: 0, y: 1 },
    }),
    "ENTITY_SCHEMA",
  );
});
it("create_map is provisional on cancel, survives approved undo as an empty map, and resize needs explicit crop", async () => {
  const h = harness(),
    before = h.host.snapshot();
  await h.begin();
  const create = async () =>
    success(
      await h.edit("create_map", {
        name: "New",
        width: 8,
        height: 8,
        tileWidth: 16,
        tileHeight: 32,
        world: { x: -20, y: 30 },
      }),
    );
  await create();
  expect(h.host.stores.size).toBe(2);
  await h.api.userAction("discard");
  expect(h.host.snapshot()).toEqual(before);
  await h.begin();
  await create();
  const mapId = [...h.host.stores.keys()].find((id) => id !== "map-1")!,
    store = h.host.stores.get(mapId)!,
    layerId = store.document.layers[0]!.id;
  success(
    await h.edit("paint_rect", {
      mapId,
      layerId,
      region: { x: 7, y: 7, width: 1, height: 1 },
      value: tile,
    }),
  );
  error(
    await h.edit("resize_map", { mapId, width: 4, height: 4 }),
    "CROP_REQUIRES_EXPLICIT_ALLOW",
  );
  success(
    await h.edit("resize_map", { mapId, width: 4, height: 4, allowCrop: true }),
  );
  await h.api.userAction("approve");
  expect(h.host.history.undoDepth).toBe(1);
  h.host.history.undo();
  expect(h.host.stores.has(mapId)).toBe(true);
  expect(store.document.layers).toEqual([]);
  h.host.history.redo();
  expect(store.document.map.width).toBe(4);
});
it("prepare_smart_source, smart_brush and draw_path reuse the core planners and undo generated metadata", async () => {
  const h = harness(),
    before = h.host.snapshot();
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
  );
  expect(prepared.data).toMatchObject({
    usages: ["area", "road"],
    forced: true,
  });
  const sourceId = "sourceId" in prepared.data ? prepared.data.sourceId : "";
  success(
    await h.edit("smart_brush", {
      mapId: "map-1",
      layerId: "ground",
      sourceId,
      mode: "area",
      region: { x: 2, y: 2, width: 4, height: 4 },
    }),
  );
  success(
    await h.edit("smart_brush", {
      mapId: "map-1",
      layerId: "ground",
      sourceId,
      mode: "road",
      cells: [
        { x: 6, y: 3 },
        { x: 7, y: 3 },
      ],
    }),
  );
  success(
    await h.edit("draw_path", {
      mapId: "map-1",
      layerId: "ground",
      sourceId,
      kind: "river",
      points: [
        { x: 7, y: 3 },
        { x: 10, y: 7 },
      ],
      width: 1,
    }),
  );
  error(
    await h.edit("draw_path", {
      mapId: "map-1",
      layerId: "ground",
      sourceId: "missing",
      kind: "path",
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    }),
    "UNKNOWN_ID",
  );
  await h.api.userAction("discard");
  expect(h.host.snapshot()).toEqual(before);
});
it("render_preview returns a bounded PNG; validate_map is structural and leaves protected old content valid", async () => {
  const h = harness();
  const image = await h.read("render_preview", {
    mapId: "map-1",
    region,
    coordinates: true,
  });
  success(image);
  expect(image.content[1]).toMatchObject({ type: "image" });
  const valid = success(await h.read("validate_map", { mapId: "map-1" }));
  expect(valid.data).toMatchObject({
    valid: true,
    issues: [],
    truncated: false,
  });
  error(
    await h.read("render_preview", { mapId: "map-1", layerIds: ["missing"] }),
    "UNKNOWN_ID",
  );
  error(
    await h.read("validate_map", {
      mapId: "map-1",
      region: { x: 15, y: 15, width: 2, height: 2 },
    }),
    "OUT_OF_BOUNDS",
  );
});
it("get_tags/set_tags are independent of pending map approval and preflight the whole batch", async () => {
  const h = harness(),
    record = success(await h.read("get_tags", { limit: 1 }));
  const fingerprint =
    "items" in record.data
      ? (record.data.items[0] as { currentFingerprint: string })
          .currentFingerprint
      : "";
  const entries = [
    {
      target: { kind: "tile", tilesetId: "tiles", tileId: 0 },
      expectedFingerprint: fingerprint,
      tags: [" grass ", "green"],
    },
  ];
  success(
    await h.run("set_tags", {
      context: { ...h.context(), idempotencyKey: "tags-0001" },
      entries,
    }),
  );
  expect(h.host.tagsText).toContain("grass");
  await h.begin();
  success(
    await h.run("set_tags", {
      context: { ...h.context(), idempotencyKey: "tags-0002" },
      entries: [{ ...entries[0], tags: ["river"] }],
    }),
  );
  await h.api.userAction("discard");
  expect(h.host.tagsText).toContain("river");
  expect(h.host.history.undoDepth).toBe(0);
  const before = h.host.tagsText;
  error(
    await h.run("set_tags", {
      context: { ...h.context(), idempotencyKey: "tags-0003" },
      entries: [{ ...entries[0], expectedFingerprint: "f".repeat(64) }],
    }),
    "TAG_FINGERPRINT_CHANGED",
  );
  error(
    await h.run("set_tags", {
      context: { ...h.context(), idempotencyKey: "tags-0004" },
      entries: [entries[0], entries[0]],
    }),
    "INVALID_ARGUMENT",
  );
  expect(h.host.tagsText).toBe(before);
});

it.each(Object.entries(examples.tools))(
  "%s frozen invalid schema fixtures never mutate state",
  async (name, vectors) => {
    const h = harness();
    await h.begin();
    const before = h.host.snapshot();
    for (const args of vectors.invalid)
      error(await h.run(name as ToolName, args), "INVALID_ARGUMENT");
    expect(h.host.snapshot()).toEqual(before);
  },
);

it("catalog defaults produce tile PNGs at scale 2; explicit tile IDs exclude offset and limit", async () => {
  const h = harness();
  const result = await h.read("get_tile_catalog", {
    tilesetId: "tiles",
    tileIds: [0],
  });
  success(result);
  expect(result.content[1]).toMatchObject({ type: "image" });
  expect(result.structuredContent).toMatchObject({
    data: { image: { mode: "tiles", scale: 2 } },
  });
  error(
    await h.read("get_tile_catalog", {
      tilesetId: "tiles",
      tileIds: [0],
      limit: 1,
    }),
    "INVALID_ARGUMENT",
  );
  error(
    await h.read("get_tile_catalog", {
      tilesetId: "tiles",
      image: "tiles",
      sheetRegion: { x: 0, y: 0, width: 1, height: 1 },
    }),
    "INVALID_ARGUMENT",
  );
});

it("a single-layer smart source writes the explicit requested layer", async () => {
  const h = harness();
  await h.begin();
  success(
    await h.edit("edit_layer", {
      mapId: "map-1",
      action: "create",
      name: "Roads",
      kind: "tile",
    }),
  );
  const store = h.host.stores.get("map-1")!,
    target = store.document.layers.at(-1)!.id;
  const prepared = success(
    await h.edit("prepare_smart_source", {
      mapId: "map-1",
      source: {
        tilesetId: "tiles",
        region: { x: 0, y: 0, width: 3, height: 3 },
      },
      force: true,
    }),
  );
  const sourceId = "sourceId" in prepared.data ? prepared.data.sourceId : "";
  success(
    await h.edit("smart_brush", {
      mapId: "map-1",
      layerId: target,
      sourceId,
      mode: "area",
      region: { x: 2, y: 2, width: 2, height: 2 },
    }),
  );
  expect(store.document.getLayer(target)!.getCell(2, 2)).not.toBe(0);
  expect(store.document.getLayer("ground")!.getCell(2, 2)).toBe(0);
});
