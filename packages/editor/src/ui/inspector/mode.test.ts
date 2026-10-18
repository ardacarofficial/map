import { describe, expect, it } from "vitest";

import { brushContent, inspectorMode, type ModeInput } from "./mode";

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
  it("library stamps yield to every higher-priority context and replace the brush/map group", () => {
    expect(mode({ libraryStamp: true })).toBe("stamp");
    expect(mode({ libraryStamp: true, tool: "hand" })).toBe("stamp");
    expect(mode({ libraryStamp: true, brush: "stamp" })).toBe("stamp");
    expect(mode({ libraryStamp: true, entitySelected: true })).toBe("entity");
    expect(mode({ libraryStamp: true, brush: "random" })).toBe("brush");
    expect(mode({ libraryStamp: true, tool: "select", region: true })).toBe("region");
    expect(mode({ libraryStamp: true, layer: "collision" })).toBe("collision");
  });
  it("collision wins over the brush", () => { expect(mode({ layer: "collision" })).toBe("collision"); });
  it("reads the brush content", () => {
    expect(brushContent({ stamp: {}, randomSet: [1, 2], selection: {} })).toBe("stamp");
    expect(brushContent({ stamp: null, randomSet: [1, 2], selection: {} })).toBe("random");
    expect(brushContent({ stamp: null, randomSet: [1], selection: {} })).toBe("tile");
    expect(brushContent({ stamp: null, randomSet: [], selection: null })).toBe("none");
  });
});
