import { describe, expect, it } from "vitest";

import { brushContent, inspectorMode, terrainEditActive, type ModeInput } from "./mode";

const base: ModeInput = { entitySelected: false, layer: "tile", tool: "brush", region: false, brush: "tile" };
const mode = (patch: Partial<ModeInput>) => inspectorMode({ ...base, ...patch });

describe("inspector mode (first match wins)", () => {
  it("entity beats everything", () => {
    expect(mode({ entitySelected: true, region: true, tool: "select", layer: "collision" })).toBe("entity");
  });
  it("marquee region with the select tool", () => {
    expect(mode({ tool: "select", region: true })).toBe("region");
    expect(mode({ tool: "select", region: true, layer: "collision" })).toBe("region");
    // A leftover region under another tool does not take over.
    expect(mode({ tool: "brush", region: true })).toBe("brush");
  });
  it("collision layer and the terrain brush", () => {
    expect(mode({ layer: "collision" })).toBe("collision");
    expect(mode({ terrainBrush: true })).toBe("terrain");
    expect(mode({ terrainBrush: true, tool: "fill" })).toBe("terrain");
    // The terrain brush paints tile layers only; other layers / tools keep their card.
    expect(mode({ terrainBrush: true, layer: "collision" })).toBe("collision");
    expect(mode({ terrainBrush: true, tool: "select" })).toBe("map");
  });
  it("defining a terrain wins over everything but an entity", () => {
    expect(mode({ terrainEdit: true, layer: "collision", tool: "select", region: true })).toBe("terrain");
    expect(mode({ terrainEdit: true, entitySelected: true })).toBe("entity");
  });
  it("brush card for paint tools on tile layers, also empty", () => {
    for (const tool of ["brush", "eraser", "fill", "rect"] as const) expect(mode({ tool })).toBe("brush");
    expect(mode({ brush: "none" })).toBe("brush");
    expect(mode({ tool: "select", brush: "stamp" })).toBe("brush");
  });
  it("map when nothing applies", () => {
    expect(mode({ tool: "select" })).toBe("map");
    expect(mode({ tool: "hand" })).toBe("map");
    expect(mode({ layer: "entity", tool: "entity" })).toBe("map");
    expect(mode({ layer: "none" })).toBe("map");
  });
  it("reads the brush content", () => {
    expect(brushContent({ stamp: {}, randomSet: [1, 2], selection: {} })).toBe("stamp");
    expect(brushContent({ stamp: null, randomSet: [1, 2], selection: {} })).toBe("random");
    expect(brushContent({ stamp: null, randomSet: [1], selection: {} })).toBe("tile");
    expect(brushContent({ stamp: null, randomSet: [], selection: null })).toBe("none");
  });
});

describe("terrain edit context", () => {
  it("opens the terrain card as soon as the dock enters terrain mode, before a draft exists", () => {
    const terrainEdit = terrainEditActive("terrain", false);
    expect(terrainEdit).toBe(true);
    expect(mode({ terrainEdit, brush: "none", tool: "select", region: true, layer: "collision" })).toBe("terrain");
    expect(mode({ terrainEdit, entitySelected: true })).toBe("entity");
  });

  it("keeps draft/fix editing active in other dock modes", () => {
    for (const dockMode of ["pick", "solid", "random"] as const) {
      expect(terrainEditActive(dockMode, true)).toBe(true);
      expect(terrainEditActive(dockMode, false)).toBe(false);
    }
  });
});
