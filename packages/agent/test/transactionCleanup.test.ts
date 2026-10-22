import { expect, it } from "vitest";
import { harness, success, tile } from "./helpers";

it.each(["approve", "discard"] as const)("%s releases map ownership and admission when a source release observer throws", async action => {
  const h = harness(), before = h.host.snapshot();
  await h.begin();
  success(await h.edit("paint_cells", { mapId: "map-1", layerId: "ground",
    cells: [{ x: 0, y: 0, value: tile }] }));
  const release = h.host.smartSources.releaseTransaction;
  h.host.smartSources.releaseTransaction = (id, outcome) => {
    release(id, outcome);
    throw Error("Asset removal observer failed");
  };
  await h.api.userAction(action);
  expect(h.api.getState().phase).toBe("ready");
  expect(h.api.getState().transaction!.outcome).toBe(action === "approve" ? "approved" : "cancelled");
  expect(h.host.transactions.writeGate.blocked).toBe(false);
  expect(h.host.pins.size).toBe(0);
  const lease = h.host.stores.get("map-1")!.acquireEditLease({});
  lease.release();
  expect(h.host.activity.entries().some(entry => entry.status === "failed" && entry.code === "INTERNAL_ERROR")).toBe(true);
  if (action === "discard") expect(h.host.snapshot()).toEqual(before);
  else {
    expect(h.host.history.undoDepth).toBe(1);
    h.host.history.undo();
    expect(h.host.stores.get("map-1")!.document.getLayer("ground")!.getCell(0, 0)).toBe(0);
    h.host.history.redo();
    expect(h.host.stores.get("map-1")!.document.getLayer("ground")!.getCell(0, 0)).not.toBe(0);
  }
  await h.begin();
  await h.api.userAction("discard");
  await h.api.dispose();
});
