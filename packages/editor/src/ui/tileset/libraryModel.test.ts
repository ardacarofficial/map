import { describe, expect, it } from "vitest";

import {
  bestMatch,
  effectiveZoom,
  filterTilesets,
  groupNames,
  groupTilesets,
  planTilesetMove,
  summarizeUsage,
  uniqueGroupName,
  UNGROUPED,
} from "./libraryModel";

const ts = (id: string, group?: string, name = id) => ({ id, name, ...(group ? { group } : {}) });

describe("library search", () => {
  const list = [ts("a", undefined, "Çimen"), ts("b", undefined, "Zindan duvarı"), ts("c", undefined, "Kale İç"), ts("d", undefined, "Duvar")];
  it("filters by name, ignoring case and Turkish accents", () => {
    expect(filterTilesets(list, "cimen").map((x) => x.id)).toEqual(["a"]);
    expect(filterTilesets(list, "DUVAR").map((x) => x.id)).toEqual(["b", "d"]);
    expect(filterTilesets(list, "iç").map((x) => x.id)).toEqual(["c"]);
    expect(filterTilesets(list, "  ").length).toBe(4);
  });
  it("Enter jumps to a name that starts with the query first", () => {
    expect(bestMatch(list, "duv")?.id).toBe("d");
    expect(bestMatch(list, "zin")?.id).toBe("b");
    expect(bestMatch(list, "xyz")).toBeNull();
  });
});

describe("groups", () => {
  const list = [ts("a"), ts("b", "Zindan"), ts("c", "Orman"), ts("d", "Zindan"), ts("e")];
  it("keep library order, the ungrouped bucket last", () => {
    expect(groupTilesets(list).map((g) => [g.name, g.tilesets.map((x) => x.id)])).toEqual([
      ["Zindan", ["b", "d"]],
      ["Orman", ["c"]],
      [UNGROUPED, ["a", "e"]],
    ]);
    expect(groupNames(list)).toEqual(["Zindan", "Orman"]);
  });

  it("drop before a tileset of the same group only reorders", () => {
    // d before b → index 1 in the document.
    expect(planTilesetMove(list, "d", { group: "Zindan", beforeId: "b" })).toEqual({ index: 1, group: undefined });
  });

  it("drop on another group regroups and lands after its last tileset", () => {
    expect(planTilesetMove(list, "a", { group: "Orman", beforeId: null })).toEqual({ index: 2, group: "Orman" });
    // Into the ungrouped bucket: group removed (null).
    expect(planTilesetMove(list, "c", { group: UNGROUPED, beforeId: null })).toEqual({ index: 4, group: null });
  });

  it("a new group goes before the ungrouped tilesets", () => {
    expect(planTilesetMove(list, "e", { group: "Yeni", beforeId: null })).toEqual({ index: 0, group: "Yeni" });
  });

  it("no change → null", () => {
    expect(planTilesetMove(list, "d", { group: "Zindan", beforeId: null })).toBeNull();
    expect(planTilesetMove(list, "b", { group: "Zindan", beforeId: "b" })).toBeNull();
    expect(planTilesetMove(list, "zz", { group: "", beforeId: null })).toBeNull();
  });

  it("unique group names", () => {
    expect(uniqueGroupName(list, "Grup")).toBe("Grup");
    expect(uniqueGroupName([ts("x", "Grup"), ts("y", "grup 2")], "Grup")).toBe("Grup 3");
  });
});

describe("zoom and usage", () => {
  it("own zoom wins over the global zoom, which wins over fit", () => {
    expect(effectiveZoom(3, 2, 1.5)).toBe(3);
    expect(effectiveZoom(null, 2, 1.5)).toBe(2);
    expect(effectiveZoom(undefined, null, 1.5)).toBe(1.5);
  });
  it("sums painted tile usage over levels", () => {
    const u = summarizeUsage([
      { cells: 400, layers: ["a"] },
      { cells: 12, layers: ["b"] },
      { cells: 0, layers: [] },
    ]);
    expect(u).toEqual({ cells: 412, levels: 2, stamps: 0, used: true });
    expect(summarizeUsage([{ cells: 0, layers: [] }]).used).toBe(false);
  });
});
