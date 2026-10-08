import type { TileClip } from "@smap/core";
import { describe, expect, it } from "vitest";

import { gridPickEvent, pickEvent, recentTileOf, strokeSummary } from "./canvasEvents";

const region = { x: 3, y: 4, width: 1, height: 1 };
const clip: TileClip = {
  width: 2,
  height: 1,
  palette: [{ tilesetId: "ts", tileId: 5 }],
  layers: [{ layerId: "l1", name: "Zemin", cells: [1, 1] }],
} as unknown as TileClip;

describe("pick events", () => {
  it("a single tile pick reports the tile and goes to recent tiles", () => {
    const e = pickEvent({ kind: "tile", entry: { tilesetId: "ts", tileId: 7 } }, null, region);
    expect(e).toEqual({ kind: "tile", tilesetId: "ts", tileId: 7, region });
    expect(recentTileOf(e!)).toEqual({ tilesetId: "ts", tileId: 7 });
  });

  it("an area pick reports the clip and is not a recent tile", () => {
    const area = { x: 0, y: 0, width: 2, height: 1 };
    const e = pickEvent({ kind: "clip", layerId: "l1", region: area }, clip, area);
    expect(e).toEqual({ kind: "clip", clip, region: area });
    expect(recentTileOf(e!)).toBeNull();
  });

  it("nothing picked → no event", () => {
    expect(pickEvent({ kind: "none" }, null, region)).toBeNull();
    // a clip result whose copy failed
    expect(pickEvent({ kind: "clip", layerId: "l1", region }, null, region)).toBeNull();
  });

  it("grid value picks carry the value", () => {
    const e = gridPickEvent(2, region);
    expect(e).toEqual({ kind: "grid", value: 2, region });
    expect(recentTileOf(e)).toBeNull();
  });

  it("copies the region (later edits of the source do not leak)", () => {
    const r = { ...region };
    const e = pickEvent({ kind: "tile", entry: { tilesetId: "ts", tileId: 1 } }, null, r)!;
    r.x = 99;
    expect(e.region.x).toBe(3);
  });
});

describe("stroke summaries", () => {
  it("reports changed cells, nothing for a no-op", () => {
    expect(strokeSummary("fill", 312)).toEqual({ tool: "fill", cells: 312 });
    expect(strokeSummary("brush", 0)).toBeNull();
  });
});
