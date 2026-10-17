import { afterEach, describe, expect, it, vi } from "vitest";

import { LIBRARY_COLLAPSED_KEY } from "./columns";
import { clampDockHeight, defaultDockHeight, DOCK, effectiveDockHeight, LEFT_PANEL_KEY } from "./layoutStore";

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
  it("fits eight tile rows plus the new chrome, capped at forty percent of the viewport", () => {
    expect(defaultDockHeight(900)).toBe(324);
    expect(defaultDockHeight(768)).toBe(307);
    expect(defaultDockHeight(500)).toBe(200);
    expect(defaultDockHeight(100)).toBe(DOCK.min);
    expect(defaultDockHeight(Number.NaN)).toBe(DOCK.initial);
  });

  it("keeps manually resized heights and the drag bounds", () => {
    expect(effectiveDockHeight(null, 768)).toBe(307);
    expect(effectiveDockHeight(400, 768)).toBe(400);
    expect(clampDockHeight(12)).toBe(DOCK.min);
    expect(clampDockHeight(900)).toBe(DOCK.max);
  });
});
