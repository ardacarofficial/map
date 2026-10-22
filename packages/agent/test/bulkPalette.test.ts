import { expect, it } from "vitest";
import { serializeLevel } from "@smap/core";
import { error, harness, stamp, success, tile } from "./helpers";

for (const tool of ["place_stamp", "smart_brush"] as const)
  for (const action of ["approve", "discard"] as const)
    it(`${tool} owns one palette snapshot pair and restores exact content on ${action}`, async () => {
      const h = harness({ stamps: [stamp] }), store = h.host.stores.get("map-1")!;
      const before = h.host.snapshot(), beforeText = serializeLevel(store.document);
      await h.begin();
      if (tool === "place_stamp") {
        success(await h.edit(tool, { mapId: "map-1", stampId: "house", at: { x: 1, y: 1 } }));
      } else {
        const prepared = success(await h.edit("prepare_smart_source", {
          mapId: "map-1", source: { tilesetId: "tiles", region: { x: 0, y: 0, width: 3, height: 3 } }, force: true,
        }));
        if (!("sourceId" in prepared.data)) throw new Error("Missing prepared source");
        success(await h.edit(tool, { mapId: "map-1", layerId: "ground", sourceId: prepared.data.sourceId, mode: "area", region: { x: 1, y: 1, width: 4, height: 4 } }));
      }
      const afterText = serializeLevel(store.document);
      expect(afterText).not.toBe(beforeText);
      await h.api.userAction(action);
      if (action === "discard") expect(h.host.snapshot()).toEqual(before);
      else {
        const snapshots = store.peekUndo()!.changes.filter(c => c.kind === "paletteAppend");
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]!.before).toHaveLength(0);
        expect(snapshots[0]!.after.length).toBeGreaterThan(1);
        h.host.history.undo();
        expect(serializeLevel(store.document)).toBe(beforeText);
        h.host.history.redo();
        expect(serializeLevel(store.document)).toBe(afterText);
      }
    });

it("rejects a late invalid paint reference without allocating or losing previous pending work", async () => {
  const h = harness();
  await h.begin();
  success(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground", cells: [{ x: 0, y: 0, value: tile }] }));
  const before = h.host.snapshot(), revision = h.api.getState().revision;
  error(await h.edit("paint_cells", {
    mapId: "map-1", layerId: "ground", cells: [
      { x: 1, y: 0, value: { tilesetId: "tiles", tileId: 1 } },
      { x: 2, y: 0, value: { tilesetId: "tiles", tileId: 999 } },
    ],
  }), "UNKNOWN_ID");
  expect(h.host.snapshot()).toEqual(before);
  expect(h.api.getState()).toMatchObject({ phase: "running", revision });
});
