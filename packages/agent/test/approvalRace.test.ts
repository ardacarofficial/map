import { expect, it } from "vitest";
import { harness, success, tile } from "./helpers";

it.each([
  { phase: "running", action: "external" },
  { phase: "awaitingApproval", action: "external" },
  { phase: "awaitingApproval", action: "discard" },
] as const)("$action while approving a $phase draft cancels it before follower enlistment commits", async ({ phase, action }) => {
  const seed = harness();
  const h = harness({ maps: [
    { id: "map-1", store: seed.host.stores.get("map-1")! },
    { id: "map-2", store: harness().host.stores.get("map-1")! },
  ] });
  const maps = h.host.world.maps;
  let loaded = false;
  h.host.world.maps = () => maps().map(map => map.id === "map-2" ? { ...map, loaded } : map);
  const before = h.host.snapshot();
  await h.begin();
  success(await h.edit("paint_cells", {
    mapId: "map-1", layerId: "ground", cells: [{ x: 1, y: 1, value: tile }],
  }));
  if (phase === "awaitingApproval") success(await h.edit("finish_edit"));
  loaded = true;
  let resolve!: () => void;
  const gate = new Promise<void>(done => { resolve = done; });
  const load = h.host.loadMap;
  let loading = false;
  h.host.loadMap = async id => {
    if (id === "map-2") { loading = true; await gate; }
    return load(id);
  };
  const approval = h.api.userAction("approve");
  for (let i = 0; i < 20 && !loading; i++) await Promise.resolve();
  expect(loading).toBe(true);
  let discard: Promise<void> | undefined;
  if (action === "external") h.host.contentChanged();
  else discard = h.api.userAction("discard");
  await expect(approval).rejects.toMatchObject({ code: "CANCELLED" });
  await discard;
  // Cancellation and admission release must not wait for the abandoned disk IO.
  success(await h.run("get_session", {}));
  expect(h.api.getState().transaction!.outcome).toBe("cancelled");
  expect(h.host.history.undoDepth).toBe(0);
  expect(h.host.snapshot()).toEqual(before);
  expect(h.host.transactions.writeGate.blocked).toBe(false);
  expect(h.host.pins.size).toBe(0);
  resolve();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(h.host.snapshot()).toEqual(before);
  expect(h.api.getState().phase).toBe("ready");
  await h.api.dispose();
});
