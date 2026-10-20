import { expect, it } from "vitest";
import { harness, success, tile } from "./helpers";

it("records explicit read targets, mutation deltas and review totals in activity", async () => {
  const h = harness();
  success(await h.read("get_map_info", { mapId: "map-1" }));
  expect(h.host.activity.entries().at(-1)).toMatchObject({ tool: "get_map_info", mapIds: ["map-1"], changedCells: 0 });
  await h.begin();
  expect(h.host.activity.entries().at(-1)).toMatchObject({ tool: "begin_edit", mapIds: ["map-1"] });
  success(await h.edit("paint_rect", { mapId: "map-1", layerId: "ground", region: { x: 0, y: 0, width: 2, height: 3 }, value: tile }));
  expect(h.host.activity.entries().at(-1)).toMatchObject({ tool: "paint_rect", mapIds: ["map-1"], plannedCells: 6, changedCells: 6 });
  success(await h.edit("paint_rect", { mapId: "map-1", layerId: "ground", region: { x: 0, y: 0, width: 2, height: 3 }, value: tile }));
  expect(h.host.activity.entries().at(-1)).toMatchObject({ tool: "paint_rect", mapIds: ["map-1"], plannedCells: 6, changedCells: 0 });
  success(await h.edit("finish_edit"));
  expect(h.host.activity.entries().at(-1)).toMatchObject({ tool: "finish_edit", mapIds: ["map-1"], plannedCells: 12, changedCells: 6 });
  await h.api.userAction("discard");
});
