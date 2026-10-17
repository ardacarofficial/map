import { describe, expect, it } from "vitest";

import { contentDockHeight, wantedTilesetBodyHeight } from "./contentHeight";

describe("content dock height", () => {
  it("uses the tallest capped grid across the document, regardless of tileset order", () => {
    const overworld = { rows: 8, tileHeight: 32 };
    const dungeon = { rows: 4, tileHeight: 32 };
    expect(wantedTilesetBodyHeight([dungeon])).toBe(176);
    expect(wantedTilesetBodyHeight([overworld, dungeon])).toBe(304);
    expect(wantedTilesetBodyHeight([dungeon, overworld])).toBe(304);
  });
  it("caps every tileset at eight rows and applies its natural scale", () => {
    expect(wantedTilesetBodyHeight([{ rows: 80, tileHeight: 16 }])).toBe(304);
    expect(wantedTilesetBodyHeight([{ rows: 10, tileHeight: 48 }, { rows: 3, tileHeight: 16 }])).toBe(240);
  });
  it("assumes eight 32px rows when the document has no tilesets", () => {
    expect(wantedTilesetBodyHeight([])).toBe(304);
  });
  it("adds the tab strip, clamps to the window cap and preserves the minimum", () => {
    expect(contentDockHeight(176, 900)).toBe(204);
    expect(contentDockHeight(304, 768)).toBe(230);
    expect(contentDockHeight(0, 900)).toBe(96);
  });
});
