import { expect, it } from "vitest";
import { harness, success, error, tile } from "./helpers";

it("records retried mutation calls and bytes without counting their changes twice", async () => {
  const h = harness();
  await h.begin();
  const args = {
    context: h.writeContext(),
    mapId: "map-1",
    layerId: "ground",
    cells: [{ x: 1, y: 1, value: tile }],
  };
  success(await h.run("paint_cells", args));
  const before = h.host.snapshot(), revision = h.api.getState().revision;
  const count = h.host.activity.entries().length;
  expect(success(await h.run("paint_cells", args))).toMatchObject({ replayed: true });
  expect(h.host.activity.entries()).toHaveLength(count + 1);
  expect(h.host.activity.entries().at(-1)).toMatchObject({
    tool: "paint_cells", status: "succeeded", mapIds: ["map-1"],
    transactionId: args.context.transactionId, plannedCells: 0, changedCells: 0,
  });
  expect(h.host.activity.entries().at(-1)?.requestBytes).toBeGreaterThan(0);
  expect(h.host.activity.entries().at(-1)?.resultBytes).toBeGreaterThan(0);
  expect(h.host.snapshot()).toEqual(before);
  expect(h.api.getState().revision).toBe(revision);
  await h.api.userAction("discard");
});

it("records begin and finish retries without repeating review totals", async () => {
  const h = harness();
  const beginArgs = {
    context: h.context(), expectedRevision: 0, idempotencyKey: "retry-begin",
    requestLabel: "Retry diagnostics", mapIds: ["map-1"],
  };
  success(await h.run("begin_edit", beginArgs));
  success(await h.run("begin_edit", beginArgs));
  expect(h.host.activity.entries().filter(row => row.tool === "begin_edit")).toHaveLength(2);
  success(await h.edit("paint_rect", {
    mapId: "map-1", layerId: "ground",
    region: { x: 0, y: 0, width: 2, height: 2 }, value: tile,
  }));
  const finishArgs = { context: h.writeContext() };
  success(await h.run("finish_edit", finishArgs));
  expect(success(await h.run("finish_edit", finishArgs))).toMatchObject({ replayed: true });
  expect(h.host.activity.entries().filter(row => row.tool === "finish_edit")).toHaveLength(2);
  expect(h.host.activity.entries().at(-1)).toMatchObject({ plannedCells: 0, changedCells: 0 });
  await h.api.userAction("discard");
});

it("records a cancelled mutation replay as a failed call for the original transaction", async () => {
  const h = harness();
  await h.begin();
  const args = {
    context: h.writeContext(), mapId: "map-1", layerId: "ground",
    cells: [{ x: 1, y: 1, value: tile }],
  };
  success(await h.run("paint_cells", args));
  await h.api.userAction("discard");
  const count = h.host.activity.entries().length;
  error(await h.run("paint_cells", args), "TRANSACTION_CANCELLED");
  expect(h.host.activity.entries()).toHaveLength(count + 1);
  expect(h.host.activity.entries().at(-1)).toMatchObject({
    tool: "paint_cells", status: "failed", code: "TRANSACTION_CANCELLED",
    transactionId: args.context.transactionId, plannedCells: 0, changedCells: 0,
  });
});

it("keeps batch replay diagnostics visible when filtering activity by the affected map", async () => {
  const h = harness();
  await h.begin();
  const args = { context: h.writeContext(), operations: [{
    tool: "paint_cells", args: {
      mapId: "map-1", layerId: "ground", cells: [{ x: 1, y: 1, value: tile }],
    },
  }] };
  success(await h.run("apply_operations", args));
  success(await h.run("apply_operations", args));
  expect(h.host.activity.entries().at(-1)).toMatchObject({
    tool: "apply_operations", mapIds: ["map-1"], plannedCells: 0, changedCells: 0,
  });
  await h.api.userAction("discard");
});
