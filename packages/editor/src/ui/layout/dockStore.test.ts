import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultDockLayout, locatePanel } from "./dockModel";

afterEach(() => vi.unstubAllGlobals());
async function fresh() {
  const data: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } });
  vi.resetModules();
  const module = await import("./dockStore");
  return { ...module, data };
}
describe("dock state and commits", () => {
  it("remembers expanded sizes through collapse, hiding and viewport-independent reads", async () => {
    const { useDockStore: store, data } = await fresh();
    store.getState().setSize("left", 380, true);
    store.getState().toggleZone("left");
    expect(store.getState().layout.zones.left).toMatchObject({ state: "collapsed", expandedPx: 380 });
    store.getState().setZoneState("left", "hidden");
    store.getState().toggleZone("left");
    expect(JSON.parse(data["smap.layout.v2"]!).zones.left).toMatchObject({ state: "expanded", expandedPx: 380 });
  });
  it("reveals moved panels at their current home and adds hidden panels exactly once", async () => {
    const { useDockStore: store, revealPanel } = await fresh();
    store.getState().move("layers", { zone: "left" });
    store.getState().setZoneState("left", "hidden");
    revealPanel("layers");
    expect(locatePanel(store.getState().layout, "layers")?.zone).toBe("left");
    expect(store.getState().layout.zones.left.state).toBe("expanded");
    store.getState().hidePanel("layers"); revealPanel("layers"); revealPanel("layers");
    expect(store.getState().layout.hiddenPanels).not.toContain("layers");
    expect(locatePanel(store.getState().layout, "layers")?.zone).toBe("left");
  });
  it("keeps preview resizes out of persistence, commits once, and defers external reload during gestures", async () => {
    const { useDockStore: store, onLayoutCommit, data } = await fresh();
    const listener = vi.fn(); onLayoutCommit(listener);
    store.getState().beginGesture();
    store.getState().setSize("bottom", 350);
    expect(data["smap.layout.v2"]).toBeUndefined();
    const external = defaultDockLayout(); external.zones.right.expandedPx = 410;
    store.getState().applyExternal(external);
    expect(store.getState().layout.zones.right.expandedPx).toBe(296);
    store.getState().commit(); expect(listener).toHaveBeenCalledTimes(1);
    store.getState().endGesture();
    expect(store.getState().layout).toEqual(external);
  });
  it("notifies the UI before showing or moving a panel, while hide remains independent", async () => {
    const { useDockStore: store, onDockReveal } = await fresh();
    const reveal = vi.fn(); onDockReveal(reveal);
    store.getState().reveal("history");
    store.getState().move("tileset", { zone: "right" });
    store.getState().setZoneState("left", "expanded");
    expect(reveal).toHaveBeenCalledTimes(3);
    store.getState().hidePanel("history"); store.getState().setZoneState("right", "hidden");
    expect(reveal).toHaveBeenCalledTimes(3);
  });
  it("resets positions, tabs, weights, visibility, rulers and sizes in one commit", async () => {
    const { useDockStore: store, onLayoutCommit } = await fresh();
    store.getState().move("recent", { zone: "left", split: "start" });
    store.getState().hidePanel("history"); store.getState().setSize("bottom", 400, true);
    const l = { ...store.getState().layout, rulersVisible: false }; store.getState().update(l);
    const listener = vi.fn(); onLayoutCommit(listener); store.getState().reset();
    expect(store.getState().layout).toEqual(defaultDockLayout()); expect(listener).toHaveBeenCalledTimes(1);
  });
});
