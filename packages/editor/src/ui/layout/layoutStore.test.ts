import { afterEach, describe, expect, it, vi } from "vitest";

import { LIBRARY_COLLAPSED_KEY } from "./columns";
import { contentDockHeight } from "./dock/contentHeight";
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
    expect(storage.data[LEFT_PANEL_KEY]).toBe("project");
    expect(storage.data[LIBRARY_COLLAPSED_KEY]).toBe("0");
    store.getState().setLeftPanelTab("project");
    expect(store.getState().libraryCollapsed).toBe(false);
    store.getState().setLeftPanelTab("stamps");
    expect(store.getState()).toMatchObject({ leftPanelTab: "stamps", leftPanel: "library", libraryCollapsed: false });
    expect(storage.data[LEFT_PANEL_KEY]).toBe("stamps");
  });

  it("keeps legacy panel switching and layout reset in sync", async () => {
    const { store, storage } = await loadPanel("library");
    store.getState().showLeftPanel("project");
    expect(store.getState()).toMatchObject({ leftPanelTab: "project", leftPanel: "project", libraryCollapsed: false });
    store.getState().showLeftPanel("project");
    expect(store.getState().libraryCollapsed).toBe(true);
    store.getState().showLeftPanel("library");
    expect(store.getState()).toMatchObject({ leftPanelTab: "stamps", leftPanel: "library", libraryCollapsed: false });
    store.getState().setLeftPanelTab("project");
    store.getState().resetLayout();
    expect(store.getState()).toMatchObject({ leftPanelTab: "stamps", leftPanel: "library", libraryCollapsed: false });
    expect(storage.data[LEFT_PANEL_KEY]).toBe("stamps");
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
  // An 8-row 32px tileset wants 305px of body (see contentHeight.test.ts).
  it.each([[900, 480], [768, 360]])("leaves enough canvas height at viewport height %i", (height, minimum) => {
    const chrome = 36 + 36 + 24 + 20;
    expect(height - chrome - contentDockHeight(305, height)).toBeGreaterThanOrEqual(minimum);
  });

  it("loads and persists the dragged height across viewport sizes", async () => {
    const storage = memory({ [DOCK_HEIGHT_KEY]: "400" });
    vi.stubGlobal("localStorage", storage);
    vi.resetModules();
    const { useLayoutStore: store } = await import("./layoutStore");
    expect(store.getState().dockHeight).toBe(400);
    store.getState().setDockHeight(350, true);
    expect(storage.data[DOCK_HEIGHT_KEY]).toBe("350");
    expect(store.getState().dockHeight).toBe(350);
  });

  it("keeps the drag bounds", () => {
    expect(clampDockHeight(12)).toBe(DOCK.min);
    expect(clampDockHeight(900)).toBe(DOCK.max);
  });
});

describe("section resize reset", () => {
  it("restores the original split across reload and subsequent drags", async () => {
    const { store, storage } = await loadPanel(null);
    store.getState().setSectionHeight("properties", 91, true, 245);
    expect(store.getState().sections.properties).toMatchObject({ height: 91, resetHeight: 245 });
    vi.resetModules();
    const { useLayoutStore: reloaded } = await import("./layoutStore");
    reloaded.getState().resetSectionHeight("properties");
    expect(reloaded.getState().sections.properties.height).toBe(245);
    expect(JSON.parse(storage.data["smap.layout.sections"]!).properties.height).toBe(245);
    reloaded.getState().setSectionHeight("properties", 110, true, 180);
    reloaded.getState().resetSectionHeight("properties");
    expect(reloaded.getState().sections.properties.height).toBe(245);
    reloaded.getState().resetLayout();
    expect(reloaded.getState().sections.properties).toEqual({ height: null, collapsed: false, hidden: false });
  });

  it("uses content sizing for older stored splits without a captured height", async () => {
    const { store } = await loadPanel(null);
    store.getState().setSectionHeight("layers", 300, true);
    store.getState().resetSectionHeight("layers");
    expect(store.getState().sections.layers.height).toBeNull();
  });
});
