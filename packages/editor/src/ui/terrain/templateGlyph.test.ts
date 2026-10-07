import { BLOB_E, BLOB_N, BLOB_NE, BLOB_S, CORNER_NE, CORNER_SE, CORNER_SW, TERRAIN_TEMPLATES, terrainTemplateInfo } from "@smap/core";
import { describe, expect, it } from "vitest";
import { fillSlot, maskGlyph, templateGlyphs, templatePickerGroups } from "./templateGlyph";

const pic = (g: readonly boolean[] | null) =>
  g === null ? null : [0, 1, 2].map((r) => g.slice(r * 3, r * 3 + 3).map((on) => (on ? "#" : ".")).join("")).join("/");

describe("maskGlyph", () => {
  it("blob47: centre always on, neighbours from the bits", () => {
    expect(pic(maskGlyph("blob47", 0))).toBe(".../.#./...");
    expect(pic(maskGlyph("blob47", 255))).toBe("###/###/###");
    expect(pic(maskGlyph("blob47", BLOB_N | BLOB_NE | BLOB_E))).toBe(".##/.##/...");
    expect(pic(maskGlyph("blob47", BLOB_N | BLOB_S))).toBe(".#./.#./.#.");
  });

  it("corner16: corners from the bits, edges when both corners, centre from three", () => {
    expect(pic(maskGlyph("corner16", 0))).toBe(".../.../...");
    expect(pic(maskGlyph("corner16", CORNER_NE))).toBe("..#/.../...");
    expect(pic(maskGlyph("corner16", CORNER_NE | CORNER_SE))).toBe("..#/..#/..#");
    expect(pic(maskGlyph("corner16", CORNER_NE | CORNER_SE | CORNER_SW))).toBe("..#/.##/###");
    expect(pic(maskGlyph("corner16", 15))).toBe("###/###/###");
  });

  it("unused slots have no glyph", () => {
    expect(maskGlyph("blob47", null)).toBeNull();
  });
});

describe("templateGlyphs", () => {
  it("one glyph per slot, null exactly for unused cells; all glyphs distinct", () => {
    for (const info of TERRAIN_TEMPLATES) {
      const glyphs = templateGlyphs(info);
      expect(glyphs).toHaveLength(info.columns * info.rows);
      const used = glyphs.filter((g) => g !== null);
      expect(used).toHaveLength(info.slots);
      expect(new Set(used.map(pic)).size).toBe(info.slots);
    }
  });

  it("godot block: top-left slot is the 'south only' tile, (10, 1) unused", () => {
    const glyphs = templateGlyphs(terrainTemplateInfo("blob47-godot"));
    expect(pic(glyphs[0]!)).toBe(".../.#./.#.");
    expect(glyphs[12 + 10]).toBeNull();
  });
});

describe("templatePickerGroups / fillSlot", () => {
  it("legacy templates go under 'other', order kept", () => {
    const { main, other } = templatePickerGroups();
    expect(main.map((t) => t.id)).toEqual(["blob47-godot", "blob47-cr31", "corner16"]);
    expect(other.map((t) => t.id)).toEqual(["blob47"]);
  });

  it("fill slot shows the fully surrounded tile", () => {
    for (const info of TERRAIN_TEMPLATES) {
      const mask = info.masks[fillSlot(info)];
      expect(mask).toBe(info.family === "blob47" ? 255 : 15);
    }
  });
});
