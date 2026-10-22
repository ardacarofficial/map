import { expect, it, vi } from "vitest";
import { createAgentApi } from "../src/api";
import { createMemoryHost, memoryCall } from "../src/testing/memoryHost";
import { harness, error, success, tile } from "./helpers";

it("releasing an API removes world and tag subscriptions on every reinstall", async () => {
  const host = createMemoryHost();
  const worldOff = vi.fn(), tagsOff = vi.fn();
  const subscribeWorld = host.subscribeWorldContent, subscribeTags = host.tags.subscribe;
  host.subscribeWorldContent = listener => {
    const off = subscribeWorld(listener);
    return () => { worldOff(); off(); };
  };
  host.tags.subscribe = listener => {
    const off = subscribeTags(listener);
    return () => { tagsOff(); off(); };
  };
  for (let i = 1; i <= 3; i++) {
    const api = createAgentApi(host), listener = vi.fn();
    api.subscribe(listener);
    await api.dispose();
    await api.dispose();
    expect(worldOff).toHaveBeenCalledTimes(i);
    expect(tagsOff).toHaveBeenCalledTimes(i);
    const revision = api.getState().revision;
    host.stores.get("map-1")!.dispatch({ type: "setLayerProps", layerId: "ground", props: { name: `Layer ${i}` } });
    expect(api.getState().revision).toBe(revision);
    expect(listener).not.toHaveBeenCalled();
    error(await api.executeTool(memoryCall("get_session", {})), "CANCELLED");
  }
});

it("dispose cancels an active read and queued begin before releasing the API", async () => {
  const h = harness();
  let finish!: (value: string) => void;
  h.host.images.tileFingerprint = () => new Promise(resolve => { finish = resolve; });
  const reading = h.read("list_tilesets", {});
  for (let i = 0; i < 15; i++) await Promise.resolve();
  const beginning = h.run("begin_edit", {
    context: h.context(), idempotencyKey: "queued-begin", expectedRevision: 0,
    requestLabel: "Queued", mapIds: ["map-1"],
  });
  await h.api.dispose();
  error(await reading, "CANCELLED");
  error(await beginning, "CANCELLED");
  expect(h.host.transactions.writeGate.blocked).toBe(false);
  expect(h.host.pins.size).toBe(0);
  finish("late-source");
  const replacement = createAgentApi(h.host);
  success(await replacement.executeTool(memoryCall("get_session", {})));
  await replacement.dispose();
});

it("dispose rolls back a pending edit and prevents a queued approval", async () => {
  const h = harness(), before = h.host.snapshot();
  await h.begin();
  success(await h.edit("paint_cells", {
    mapId: "map-1", layerId: "ground", cells: [{ x: 1, y: 1, value: tile }],
  }));
  const approving = h.api.userAction("approve");
  await h.api.dispose();
  await approving;
  expect(h.host.snapshot()).toEqual(before);
  expect(h.host.history.undoDepth).toBe(0);
  expect(h.host.transactions.writeGate.blocked).toBe(false);
  expect(h.host.pins.size).toBe(0);
});

it("dispose interrupts approval waiting for a cached follower before it can commit", async () => {
  const h = harness(), before = h.host.snapshot();
  await h.begin();
  success(await h.edit("paint_cells", {
    mapId: "map-1", layerId: "ground", cells: [{ x: 1, y: 1, value: tile }],
  }));
  const maps = h.host.world.maps();
  h.host.world.maps = () => [...maps, { ...maps[0]!, id: "follower", loaded: true }];
  const load = vi.fn(() => new Promise<never>(() => {}));
  h.host.loadMap = load;
  const approving = h.api.userAction("approve");
  const rejected = expect(approving).rejects.toMatchObject({ code: "CANCELLED" });
  for (let i = 0; i < 15; i++) await Promise.resolve();
  expect(load).toHaveBeenCalledWith("follower");
  await h.api.dispose();
  await rejected;
  expect(h.host.snapshot()).toEqual(before);
  expect(h.host.history.undoDepth).toBe(0);
  expect(h.host.transactions.writeGate.blocked).toBe(false);
});
