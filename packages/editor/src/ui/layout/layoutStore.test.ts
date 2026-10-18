import { afterEach, describe, expect, it, vi } from "vitest";

import { clampDockHeight, DOCK, DOCK_HEIGHT_KEY, LEFT_PANEL_KEY } from "./layoutStore";

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (key: string) => data[key] ?? null, setItem: (key: string, value: string) => { data[key] = value; } };
}

afterEach(() => vi.unstubAllGlobals());

async function loadPanel(raw: string | null) {
  const storage = memory(raw === null ? {} : { [LEFT_PANEL_KEY]: raw });
  vi.stubGlobal("localStorage", storage);
  vi.resetModules();
  const { useLayoutStore } = await import("./layoutStore");
  return { storage, store: useLayoutStore };
}

describe("left panel tab compatibility", () => {
  it.each([
    ["project", "project", "project"],
    ["library", "stamps", "library"],
    ["stamps", "stamps", "library"],
    ["unknown", "stamps", "library"],
    [null, "stamps", "library"],
  ])("loads stored %s as %s", async (raw, tab, legacy) => {
    const { store } = await loadPanel(raw);
    expect(store.getState().leftPanelTab).toBe(tab);
    expect(store.getState().leftPanel).toBe(legacy);
  });

  it("selects and persists either tab, opening a collapsed column without toggling it closed", async () => {
    const { store, storage } = await loadPanel("library");
    store.getState().setLibraryCollapsed(true);
    store.getState().setLeftPanelTab("project");
    expect(store.getState()).toMatchObject({ leftPanelTab: "project", leftPanel: "project", libraryCollapsed: false });
    expect(JSON.parse(storage.data["smap.layout.v2"]!).zones.left).toMatchObject({ state: "expanded", groups: [{ id: "library", tabs: ["tileset", "stamps", "project", "entities"], active: "project", weight: 1, collapsed: false }] });
    store.getState().setLeftPanelTab("project");
    expect(store.getState().libraryCollapsed).toBe(false);
    store.getState().setLeftPanelTab("stamps");
    expect(store.getState()).toMatchObject({ leftPanelTab: "stamps", leftPanel: "library", libraryCollapsed: false });
    expect(JSON.parse(storage.data["smap.layout.v2"]!).zones.left.groups[0].active).toBe("stamps");
  });

  it("keeps legacy panel switching and layout reset in sync", async () => {
    const { store, storage } = await loadPanel("library");
    store.getState().showLeftPanel("project");
    expect(store.getState()).toMatchObject({ leftPanelTab: "project", leftPanel: "project", libraryCollapsed: false });
    store.getState().showLeftPanel("project");
    expect(store.getState().libraryCollapsed).toBe(false);
    store.getState().showLeftPanel("library");
    expect(store.getState()).toMatchObject({ leftPanelTab: "stamps", leftPanel: "library", libraryCollapsed: false });
    store.getState().setLeftPanelTab("project");
    store.getState().resetLayout();
    expect(store.getState()).toMatchObject({ leftPanelTab: "stamps", leftPanel: "library", libraryCollapsed: false });
    expect(JSON.parse(storage.data["smap.layout.v2"]!).zones.left.groups[0].active).toBe("tileset");
  });

  it("survives unavailable localStorage", async () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
    vi.resetModules();
    const { useLayoutStore: store } = await import("./layoutStore");
    expect(store.getState().leftPanelTab).toBe("stamps");
    expect(() => store.getState().setLeftPanelTab("project")).not.toThrow();
    expect(store.getState()).toMatchObject({ leftPanelTab: "project", leftPanel: "project", libraryCollapsed: false });
  });
});

describe("dock default height", () => {
  it.each([900, 768])("keeps the Recent-only default at viewport height %i", async (height) => {
    vi.stubGlobal("window", { innerHeight: height });
    const { store } = await loadPanel(null);
    expect(store.getState().dockHeight).toBe(68);
    expect(store.getState().dockTab).toBe("recent");
  });

  it("loads and persists the dragged height across viewport sizes", async () => {
    const storage = memory({ [DOCK_HEIGHT_KEY]: "400" });
    vi.stubGlobal("localStorage", storage);
    vi.resetModules();
    const { useLayoutStore: store } = await import("./layoutStore");
    expect(store.getState().dockHeight).toBe(400);
    store.getState().setDockHeight(350, true);
    expect(JSON.parse(storage.data["smap.layout.v2"]!).zones.bottom.expandedPx).toBe(350);
    expect(store.getState().dockHeight).toBe(350);
  });

  it("keeps the drag bounds", () => {
    expect(clampDockHeight(12)).toBe(DOCK.min);
    expect(clampDockHeight(900)).toBe(DOCK.max);
  });
});

describe("legacy section API projects onto dock groups", () => {
  it("persists a manual group ratio across reload and resets to default weights", async () => {
    const { store, storage } = await loadPanel(null);
    store.getState().setSectionHeight("properties", 100, true);
    const stored = () => JSON.parse(storage.data["smap.layout.v2"]!).zones.right.groups;
    expect(stored()[0].weight).toBeLessThan(.3);
    vi.resetModules();
    const { useLayoutStore: reloaded } = await import("./layoutStore");
    reloaded.getState().resetSectionHeight("properties");
    expect(stored()[0].weight).toBe(.6);
    reloaded.getState().resetLayout();
    expect(reloaded.getState().sections.properties).toEqual({ height: null, collapsed: false, hidden: false });
  });
  it("uses the default group ratio when a legacy caller requests automatic sizing", async () => {
    const { store, storage } = await loadPanel(null);
    store.getState().setSectionHeight("layers", 300, true);
    store.getState().resetSectionHeight("layers");
    expect(JSON.parse(storage.data["smap.layout.v2"]!).zones.right.groups[1].weight).toBe(.4);
  });
});
