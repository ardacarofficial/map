import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { defaultDockLayout, locatePanel, movePanel, normalizeLayout, hidePanel, revealInLayout, PANEL_IDS, ZONE_IDS } from "./dockModel";
import { readLayout, writeLayout } from "./layoutPersistence";

const storage = (entries: Record<string, string> = {}) => ({ getItem: (key: string) => entries[key] ?? null, setItem: (key: string, value: string) => { entries[key] = value; } });
const homes = (layout: ReturnType<typeof defaultDockLayout>) => [...ZONE_IDS.flatMap(z => layout.zones[z].groups.flatMap(g => g.tabs)), ...layout.hiddenPanels];

describe("dock model", () => {
  it("defaults to Tileset left, inspector/history over layers, Recent bottom", () => {
    const l = defaultDockLayout();
    expect(l.zones.left.groups[0]?.tabs).toEqual(["tileset", "stamps", "project", "entities"]);
    expect(l.zones.right.groups.map(g => g.tabs)).toEqual([["inspector", "history"], ["layers"]]);
    expect(l.zones.bottom.expandedPx).toBe(68);
    expect(homes(l).sort()).toEqual([...PANEL_IDS].sort());
  });
  it("moves, inserts, reorders and splits without losing or duplicating any panel", () => {
    let l = defaultDockLayout();
    for (const panel of PANEL_IDS) for (const zone of ZONE_IDS) {
      l = movePanel(l, panel, { zone, group: 0, index: 0 });
      expect(locatePanel(l, panel)?.zone).toBe(zone);
      expect(homes(l).sort()).toEqual([...PANEL_IDS].sort());
    }
    l = movePanel(defaultDockLayout(), "tileset", { zone: "right", split: "end" });
    expect(l.zones.right.groups.at(-1)?.tabs).toEqual(["tileset"]);
    expect(l.zones.right.mode).toBe("split");
  });
  it("splits either edge of the source zone without cloning the source panel", () => {
    for (const zone of ZONE_IDS) for (const split of ["start", "end"] as const) {
      const panel = defaultDockLayout().zones[zone].groups[0]!.tabs[0]!;
      const l = movePanel(defaultDockLayout(), panel, { zone, split });
      expect(homes(l).sort()).toEqual([...PANEL_IDS].sort());
      expect(l.zones[zone].groups[split === "start" ? 0 : l.zones[zone].groups.length - 1]?.tabs).toEqual([panel]);
    }
  });
  it("preserves one home and valid active tabs through arbitrary move/hide/reveal sequences", () => {
    fc.assert(fc.property(fc.array(fc.record({ panel: fc.constantFrom(...PANEL_IDS), zone: fc.constantFrom(...ZONE_IDS), action: fc.integer({ min: 0, max: 4 }), group: fc.integer({ min: 0, max: 3 }), index: fc.integer({ min: 0, max: 8 }) }), { maxLength: 80 }), steps => {
      let l = defaultDockLayout();
      for (const s of steps) {
        l = s.action === 0 ? hidePanel(l, s.panel) : s.action === 1 ? revealInLayout(l, s.panel) : movePanel(l, s.panel, { zone: s.zone, group: s.group, index: s.index, ...(s.action > 2 ? { split: s.action === 3 ? "start" : "end" } : {}) });
        expect(homes(l).sort()).toEqual([...PANEL_IDS].sort());
        for (const zone of ZONE_IDS) for (const g of l.zones[zone].groups) expect(g.tabs).toContain(g.active);
        expect(normalizeLayout(l)).toEqual(l);
      }
    }), { numRuns: 200 });
  });
  it("repairs group id collisions even when missing panels create default groups", () => {
    const raw = defaultDockLayout(); raw.zones.left.groups[0]!.id = "properties";
    raw.zones.right.groups = [];
    const l = normalizeLayout(raw)!;
    const ids = ZONE_IDS.flatMap(z => l.zones[z].groups.map(g => g.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(normalizeLayout(l)).toEqual(l);
  });
  it("restores a hidden moved panel to its remembered zone, group and tab position after reload", () => {
    let l = movePanel(defaultDockLayout(), "tileset", { zone: "right", group: 0, index: 1 });
    l = hidePanel(l, "tileset"); l = normalizeLayout(JSON.parse(JSON.stringify(l)))!;
    l = revealInLayout(l, "tileset");
    expect(locatePanel(l, "tileset")).toEqual({ zone: "right", group: 0, index: 1 });
    l = movePanel(l, "recent", { zone: "left", split: "start" });
    const id = l.zones.left.groups[0]!.id;
    l = hidePanel(l, "recent"); l = revealInLayout(normalizeLayout(l)!, "recent");
    expect(locatePanel(l, "recent")).toEqual({ zone: "left", group: 0, index: 0 });
    expect(l.zones.left.groups[0]!.id).toBe(id);
    expect(homes(l).sort()).toEqual([...PANEL_IDS].sort());
  });
  it("validates, whitelists, deduplicates, repairs active ids and adds missing panels", () => {
    const l = defaultDockLayout();
    const raw = JSON.parse(JSON.stringify(l));
    raw.zones.left.expandedPx = 9999;
    raw.zones.left.groups[0].tabs = ["tileset", "evil", "tileset"];
    raw.zones.left.groups[0].active = "evil";
    raw.zones.right.groups[0].tabs.push("tileset");
    const result = normalizeLayout(raw)!;
    expect(result.zones.left.expandedPx).toBe(400);
    expect(result.zones.left.groups[0]?.active).toBe("tileset");
    expect(homes(result).sort()).toEqual([...PANEL_IDS].sort());
    expect(normalizeLayout({ version: 3 })).toBeNull();
    expect(normalizeLayout([])).toBeNull();
  });
});

describe("layout persistence", () => {
  it("roundtrips canonical layout and settings take precedence", () => {
    const s = storage();
    const l = movePanel(defaultDockLayout(), "tileset", { zone: "right" });
    writeLayout(s, l);
    expect(readLayout(s)).toEqual(l);
    expect(readLayout(s, defaultDockLayout())).toEqual(defaultDockLayout());
  });
  it("migrates every legacy preference while moving Tileset to left", () => {
    const l = readLayout(storage({
      "smap.layout.libraryWidth": "380", "smap.layout.rightWidth": "410", "smap.layout.dockHeight": "250",
      "smap.layout.libraryCollapsed": "1", "smap.layout.inspectorCollapsed": "1", "smap.layout.recentHidden": "1",
      "smap.layout.dockCollapsed": "true", "smap.layout.leftPanel": "project", "smap.layout.rulersHidden": "1",
      "smap.layout.sections": JSON.stringify({ properties: { collapsed: true, height: 210 }, layers: { hidden: true }, levels: { hidden: true } }),
    }));
    expect(l.zones.left.expandedPx).toBe(380);
    expect(l.zones.right.expandedPx).toBe(410);
    expect(l.zones.bottom.expandedPx).toBe(250);
    expect(l.zones.left.state).toBe("collapsed");
    expect(l.zones.right.state).toBe("collapsed");
    expect(l.zones.bottom.state).toBe("hidden");
    expect(l.rulersVisible).toBe(false);
    expect(l.hiddenPanels).toEqual(expect.arrayContaining(["project", "layers"]));
    expect(locatePanel(l, "tileset")?.zone).toBe("left");
    expect(l.zones.right.groups[0]?.collapsed).toBe(true);
  });
  it("falls back safely on corrupt data and unavailable storage", () => {
    expect(readLayout(storage({ "smap.layout.v2": "{broken" }))).toEqual(defaultDockLayout());
    const blocked = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } };
    expect(readLayout(blocked)).toEqual(defaultDockLayout());
    expect(() => writeLayout(blocked, defaultDockLayout())).not.toThrow();
  });
});
