import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMajorGrid, saveMajorGrid, useMajorGrid, selectMajorGridProject } from "./majorGridSettings";

afterEach(() => vi.unstubAllGlobals());
describe("project grid view settings", () => {
  it("isolates projects, validates corrupt values, and survives unavailable storage", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
    saveMajorGrid("C:/A", { interval: 8, x: -3, y: 2 });
    expect(loadMajorGrid("C:/A")).toEqual({ interval: 8, x: -3, y: 2 });
    expect(loadMajorGrid("C:/B").interval).toBe(0);
    for (const raw of ["broken JSON", "null", '{"interval":65,"x":0,"y":0}', '{"interval":8,"x":1.5,"y":0}']) {
      data.set("smap:major-grid:C:/broken", raw);
      expect(loadMajorGrid("C:/broken")).toEqual({ interval: 0, x: 0, y: 0 });
    }
    saveMajorGrid("C:/A", { interval: 1, x: 0, y: 0 });
    expect(loadMajorGrid("C:/A").interval).toBe(0);
    vi.stubGlobal("localStorage", { getItem: () => { throw Error("denied"); }, setItem: () => { throw Error("denied"); } });
    expect(() => saveMajorGrid("C:/A", { interval: 4, x: 0, y: 0 })).not.toThrow();
    expect(loadMajorGrid("C:/A").interval).toBe(0);
  });
  it("keeps unsaved settings when saving for the first time, restores on reopen, and resets for another project", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
    selectMajorGridProject(null);
    useMajorGrid.getState().update({ interval: 16, x: 1, y: 2 });
    selectMajorGridProject("C:/new", true);
    selectMajorGridProject("C:/other");
    expect(useMajorGrid.getState().settings.interval).toBe(0);
    selectMajorGridProject("C:/new");
    expect(useMajorGrid.getState().settings).toEqual({ interval: 16, x: 1, y: 2 });
  });
});
