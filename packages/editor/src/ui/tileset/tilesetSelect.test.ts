import { clipFromTileset, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";

import { highlightedIds, pickSelection } from "./tilesetSelect";

const ts: Tileset = {
  id: "ow",
  name: "overworld-32",
  imagePath: "tilesets/overworld-32.png",
  tileWidth: 32,
  tileHeight: 32,
  columns: 8,
  rows: 8,
  margin: 0,
  spacing: 0,
};
const get = (id: string) => (id === ts.id ? ts : undefined);
const region = { x: 3, y: 4, width: 1, height: 1 };

describe("pick sync", () => {
  it("a picked tile selects that cell", () => {
    expect(pickSelection({ kind: "tile", tilesetId: "ow", tileId: 12, region }, get)).toEqual({
      tilesetId: "ow",
      ids: [12],
      anchor: { col: 4, row: 1 },
      focus: { col: 4, row: 1 },
      clip: null,
    });
    expect(pickSelection({ kind: "tile", tilesetId: "gone", tileId: 1, region }, get)).toBeNull();
  });

  it("a picked block maps to its source cells and keeps the clip", () => {
    const clip = clipFromTileset(ts, { x: 1, y: 1, w: 3, h: 2 })!;
    const sel = pickSelection({ kind: "clip", clip, region }, get);
    expect(sel?.ids).toEqual([9, 10, 11, 17, 18, 19]);
    expect(sel?.anchor).toEqual({ col: 1, row: 1 });
    expect(sel?.focus).toEqual({ col: 3, row: 2 });
    expect(sel?.clip).toBe(clip);
  });

  it("grid picks do not touch the panel", () => {
    expect(pickSelection({ kind: "grid", value: 1, region }, get)).toBeNull();
  });
});

describe("highlight", () => {
  const clip = clipFromTileset(ts, { x: 0, y: 0, w: 2, h: 1 })!;
  const panel = { tilesetId: "ow", ids: [0, 1], anchor: { col: 0, row: 0 }, focus: { col: 1, row: 0 }, clip };

  it("shows the panel cells only while their clip is the brush", () => {
    expect(highlightedIds({ stamp: clip, selection: null, randomSet: [] }, panel, "ow")).toEqual([0, 1]);
    const other = clipFromTileset(ts, { x: 0, y: 0, w: 2, h: 1 })!;
    expect(highlightedIds({ stamp: other, selection: null, randomSet: [] }, panel, "ow")).toEqual([]);
    expect(highlightedIds({ stamp: clip, selection: null, randomSet: [] }, panel, "other")).toEqual([]);
  });

  it("a single selection highlights its tile; a random set highlights nothing", () => {
    expect(highlightedIds({ stamp: null, selection: { tilesetId: "ow", tileId: 5 }, randomSet: [] }, panel, "ow")).toEqual([5]);
    const randomSet = [
      { tilesetId: "ow", tileId: 1 },
      { tilesetId: "ow", tileId: 2 },
    ];
    expect(highlightedIds({ stamp: null, selection: { tilesetId: "ow", tileId: 1 }, randomSet }, panel, "ow")).toEqual([]);
  });
});
