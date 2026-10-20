/** Transaction properties live beside core history tests to use core's existing fast-check dependency. */
import fc from "fast-check";
import { expect, it } from "vitest";
import { serializeLevel } from "../src";
import { harness, success, error, stamp, tile } from "../../agent/test/helpers";
import type { ToolName } from "../../agent/src/contracts";

const action = fc.record({
  kind: fc.integer({ min: 0, max: 10 }),
  x: fc.integer({ min: 1, max: 6 }),
  y: fc.integer({ min: 1, max: 6 }),
  tile: fc.integer({ min: 0, max: 7 }),
  flags: fc.integer({ min: 0, max: 7 }),
  invalid: fc.boolean(),
});
async function apply(
  h: ReturnType<typeof harness>,
  a: {
    kind: number;
    x: number;
    y: number;
    tile: number;
    flags: number;
    invalid: boolean;
  },
) {
  const value = { tilesetId: "tiles", tileId: a.tile, flags: a.flags };
  let name: ToolName, args: Record<string, unknown>;
  const mapId = "map-1",
    layerId = "ground";
  if (a.invalid) {
    const before = h.host.snapshot();
    error(
      await h.edit("paint_cells", {
        mapId,
        layerId,
        cells: [
          { x: a.x, y: a.y, value },
          { x: 999, y: 999, value },
        ],
      }),
      "OUT_OF_BOUNDS",
    );
    expect(h.host.snapshot()).toEqual(before);
    return;
  }
  switch (a.kind) {
    case 0:
      name = "paint_cells";
      args = { mapId, layerId, cells: [{ x: a.x, y: a.y, value }] };
      break;
    case 1:
      name = "paint_rect";
      args = {
        mapId,
        layerId,
        region: { x: a.x, y: a.y, width: 2, height: 2 },
        value,
      };
      break;
    case 2:
      name = "paint_line";
      args = {
        mapId,
        layerId,
        from: { x: a.x, y: a.y },
        to: { x: 7, y: 7 },
        width: 1,
        value,
      };
      break;
    case 3:
      name = "fill";
      args = {
        mapId,
        layerId,
        region: { x: a.x, y: a.y, width: 2, height: 2 },
        start: { x: a.x, y: a.y },
        value,
      };
      break;
    case 4:
      name = "paint_cells";
      args = { mapId, layerId, cells: [{ x: a.x, y: a.y, value: null }] };
      break;
    case 5:
      name = "place_stamp";
      args = {
        mapId,
        stampId: "house",
        at: { x: a.x, y: a.y },
        rotation: a.flags % 4,
        flipX: !!(a.flags & 1),
      };
      break;
    case 6:
      name = "edit_layer";
      args = {
        mapId,
        action: "update",
        layerId,
        props: { opacity: (a.flags + 1) / 8 },
      };
      break;
    case 7:
      name = "edit_layer";
      args = {
        mapId,
        action: "create",
        name: `Layer ${a.x}`,
        kind: "collision",
      };
      break;
    case 8:
      name = "place_entity";
      args = {
        mapId,
        layerId: "entities",
        typeId: "portal",
        at: { x: a.x, y: a.y },
        fields: { targetLevel: "map-1", targetPoint: { x: 0, y: 0 } },
      };
      break;
    case 9:
      name = "resize_map";
      args = { mapId, width: 8 + a.x, height: 8 + a.y, allowCrop: true };
      break;
    default:
      name = "paint_rect";
      args = {
        mapId,
        layerId: "collision",
        region: { x: a.x, y: a.y, width: 2, height: 2 },
        value: { collision: a.flags % 3 },
      };
  }
  const context = h.writeContext(),
    result = success(await h.run(name, { context, ...args }));
  expect(success(await h.run(name, { context, ...args }))).toMatchObject({
    replayed: true,
    revision: result.revision,
  });
}
function baseline() {
  const h = harness({ stamps: [stamp], width: 16, height: 16 }),
    s = h.host.stores.get("map-1")!;
  const index = s.getOrAddPaletteIndex("tiles", 2);
  s.dispatch({
    type: "paintCells",
    layerId: "ground",
    cells: [{ x: 0, y: 0, cell: index }],
  });
  s.dispatch({
    type: "paintCells",
    layerId: "ground",
    cells: [{ x: 15, y: 15, cell: index }],
  });
  h.host.history.undo();
  return h;
}
it("random valid/invalid tools followed by cancel restore canonical documents, palettes, dirty flags, history and prior redo", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(action, { maxLength: 25 }), async (actions) => {
      const h = baseline(),
        before = h.host.snapshot();
      await h.begin();
      for (const a of actions) await apply(h, a);
      await h.api.userAction("discard");
      expect(h.host.snapshot()).toEqual(before);
      expect(h.host.pins.size).toBe(0);
    }),
    { numRuns: 70 },
  );
});
it("random approvals create exactly one row; world undo is identity and redo restores the result", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(action, { maxLength: 20 }), async (actions) => {
      const h = baseline(),
        s = h.host.stores.get("map-1")!,
        before = serializeLevel(s.document),
        depth = h.host.history.undoDepth;
      await h.begin();
      // Guaranteed nonempty change, independent of subsequent random writes.
      success(
        await h.edit("paint_cells", {
          mapId: "map-1",
          layerId: "ground",
          cells: [{ x: 0, y: 1, value: tile }],
        }),
      );
      for (const a of actions) await apply(h, a);
      const after = serializeLevel(s.document);
      await h.api.userAction("approve");
      expect(h.host.history.undoDepth).toBe(depth + 1);
      expect(h.host.history.redoDepth).toBe(0);
      h.host.history.undo();
      expect(serializeLevel(s.document)).toBe(before);
      h.host.history.redo();
      expect(serializeLevel(s.document)).toBe(after);
    }),
    { numRuns: 70 },
  );
});
it("empty random-sized batches of no-op calls preserve redo when approved", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 40 }), async (count) => {
      const h = baseline(),
        before = h.host.snapshot();
      await h.begin();
      for (let i = 0; i < count; i++)
        success(
          await h.edit("paint_cells", {
            mapId: "map-1",
            layerId: "ground",
            cells: [{ x: 1, y: 1, value: null }],
          }),
        );
      await h.api.userAction("approve");
      expect(h.host.snapshot()).toEqual(before);
    }),
    { numRuns: 40 },
  );
});
