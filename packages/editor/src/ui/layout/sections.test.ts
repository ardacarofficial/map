import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { WidthStorage } from "./columns";
import {
  clampSectionHeight,
  DEFAULT_SECTIONS,
  fillerSection,
  isCollapsed,
  LEGACY_LEVELS_COLLAPSED_KEY,
  maxSectionHeight,
  readSections,
  SECTION_HEADER,
  SECTION_MIN,
  SECTIONS_KEY,
  sectionFlex,
  shownSections,
  splitterPairs,
  splitterTarget,
  writeSections,
  type SectionsState,
} from "./sections";

function memory(initial: Record<string, string> = {}): WidthStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

const ctx = { levelCount: 3, world: false };
const with_ = (patch: Partial<Record<keyof SectionsState, Partial<SectionsState["levels"]>>>): SectionsState => ({
  levels: { ...DEFAULT_SECTIONS.levels, ...patch.levels },
  properties: { ...DEFAULT_SECTIONS.properties, ...patch.properties },
  layers: { ...DEFAULT_SECTIONS.layers, ...patch.layers },
});

describe("sections persistence", () => {
  it("round-trips hidden / folded / heights", () => {
    const s = memory();
    const state = with_({ levels: { collapsed: true, height: 120 }, layers: { height: 300 }, properties: { hidden: true } });
    writeSections(s, state);
    expect(readSections(s)).toEqual(state);
  });

  it("falls back to defaults for missing, broken or throwing storage", () => {
    expect(readSections(memory())).toEqual(DEFAULT_SECTIONS);
    expect(readSections(memory({ [SECTIONS_KEY]: "{not json" }))).toEqual(DEFAULT_SECTIONS);
    expect(readSections(memory({ [SECTIONS_KEY]: JSON.stringify({ layers: { height: "tall", hidden: 1 } }) }))).toEqual(DEFAULT_SECTIONS);
    const throwing: WidthStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSections(throwing)).toEqual(DEFAULT_SECTIONS);
    expect(() => writeSections(throwing, DEFAULT_SECTIONS)).not.toThrow();
    expect(readSections(null)).toEqual(DEFAULT_SECTIONS);
  });

  it("keeps a stored height at least the section minimum", () => {
    const s = memory({ [SECTIONS_KEY]: JSON.stringify({ layers: { height: 3 } }) });
    expect(readSections(s).layers.height).toBe(SECTION_MIN.layers);
  });

  it("takes over the old level-list folded flag once", () => {
    expect(readSections(memory({ [LEGACY_LEVELS_COLLAPSED_KEY]: "1" })).levels.collapsed).toBe(true);
    expect(readSections(memory({ [LEGACY_LEVELS_COLLAPSED_KEY]: "0" })).levels.collapsed).toBe(false);
    // The new state wins once it exists.
    const s = memory({ [LEGACY_LEVELS_COLLAPSED_KEY]: "1", [SECTIONS_KEY]: JSON.stringify(DEFAULT_SECTIONS) });
    expect(readSections(s).levels.collapsed).toBeNull();
  });
});

describe("sections layout", () => {
  it("folds the level list automatically only while there is one level (not on the world map)", () => {
    expect(isCollapsed("levels", DEFAULT_SECTIONS.levels, { levelCount: 1, world: false })).toBe(true);
    expect(isCollapsed("levels", DEFAULT_SECTIONS.levels, { levelCount: 2, world: false })).toBe(false);
    expect(isCollapsed("levels", DEFAULT_SECTIONS.levels, { levelCount: 1, world: true })).toBe(false);
    expect(isCollapsed("levels", { ...DEFAULT_SECTIONS.levels, collapsed: false }, { levelCount: 1, world: false })).toBe(false);
  });

  it("lists only the level list on the world map, and skips hidden sections", () => {
    expect(shownSections(DEFAULT_SECTIONS, { levelCount: 2, world: true })).toEqual(["levels"]);
    expect(shownSections(with_({ properties: { hidden: true } }), ctx)).toEqual(["levels", "layers"]);
  });

  it("gives the remaining height to Özellik, else Katmanlar, else Level'lar", () => {
    expect(fillerSection(DEFAULT_SECTIONS, ctx)).toBe("properties");
    expect(fillerSection(with_({ properties: { collapsed: true } }), ctx)).toBe("layers");
    expect(fillerSection(with_({ properties: { hidden: true }, layers: { collapsed: true } }), ctx)).toBe("levels");
    expect(fillerSection(with_({ levels: { collapsed: true }, properties: { collapsed: true }, layers: { collapsed: true } }), ctx)).toBeNull();
  });

  it("puts splitters between open neighbours; each resizes the non-filler side", () => {
    expect(splitterPairs(DEFAULT_SECTIONS, ctx)).toEqual([
      ["levels", "properties"],
      ["properties", "layers"],
    ]);
    expect(splitterPairs(with_({ properties: { collapsed: true } }), ctx)).toEqual([]);
    expect(splitterTarget("levels", "properties", "properties")).toEqual({ section: "levels", sign: 1 });
    expect(splitterTarget("properties", "layers", "properties")).toEqual({ section: "layers", sign: -1 });
    expect(splitterTarget("levels", "layers", "layers")).toEqual({ section: "levels", sign: 1 });
  });

  it("clamps a dragged height between the minimum and what the others leave", () => {
    const column = 700;
    const max = maxSectionHeight("layers", column, DEFAULT_SECTIONS, ctx);
    expect(max).toBe(column - SECTION_MIN.levels - SECTION_MIN.properties);
    expect(clampSectionHeight("layers", 10, column, DEFAULT_SECTIONS, ctx)).toBe(SECTION_MIN.layers);
    expect(clampSectionHeight("layers", 5000, column, DEFAULT_SECTIONS, ctx)).toBe(max);
    expect(clampSectionHeight("layers", Number.NaN, column, DEFAULT_SECTIONS, ctx)).toBe(SECTION_MIN.layers);
    // A folded neighbour only keeps its header.
    const folded = with_({ levels: { collapsed: true } });
    expect(maxSectionHeight("layers", column, folded, ctx)).toBe(column - SECTION_HEADER - SECTION_MIN.properties);
  });

  it("never clamps outside [min, max] and max never below min (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3000 }), fc.double({ min: -1e5, max: 1e5, noNaN: true }), fc.boolean(), (column, value, foldLevels) => {
        const state = with_({ levels: { collapsed: foldLevels } });
        const h = clampSectionHeight("layers", value, column, state, ctx);
        const max = maxSectionHeight("layers", column, state, ctx);
        expect(max).toBeGreaterThanOrEqual(SECTION_MIN.layers);
        expect(h).toBeGreaterThanOrEqual(SECTION_MIN.layers);
        expect(h).toBeLessThanOrEqual(max);
      }),
    );
  });

  it("sizes sections: header only, filler, dragged height or content", () => {
    expect(sectionFlex("properties", DEFAULT_SECTIONS, ctx).flex).toBe("1 1 0px");
    expect(sectionFlex("layers", DEFAULT_SECTIONS, ctx).flex).toBe("0 1 auto");
    expect(sectionFlex("layers", with_({ layers: { height: 240 } }), ctx).flex).toBe("0 1 240px");
    expect(sectionFlex("levels", with_({ levels: { collapsed: true } }), ctx)).toEqual({ flex: "0 0 auto", minHeight: SECTION_HEADER });
  });
});
