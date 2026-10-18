import { FLIP_D, FLIP_H, flipClip, makeCell, rectangleBandContains, type TileClip } from "@smap/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rectangleStampSource } from "./rectangleSource";

const clip: TileClip = {
  width: 3, height: 2, palette: [{ tilesetId: "t", tileId: 1 }],
  layers: [
    { layerId: "a", name: "A", cells: Uint32Array.of(1, makeCell(1, FLIP_H), 1, 1, 1, makeCell(1, FLIP_D)) },
    { layerId: "b", name: "B", grid: true, role: "collision", cells: Uint32Array.of(1, 2, 1, 2, 1, 2) },
  ],
};

describe("rectangle stamp source", () => {
  it("masks every layer after flipping, preserves source data/flags, and emits no interior or exterior cells", () => {
    fc.assert(fc.property(fc.integer({ min: -3, max: 10 }), fc.integer({ min: -3, max: 10 }), fc.boolean(), fc.boolean(), fc.integer({ min: 1, max: 8 }), (x, y, flipX, flipY, thickness) => {
      const region = { x: 0, y: 0, width: 9, height: 8 };
      let oriented = clip;
      if (flipX) oriented = flipClip(oriented, "x");
      if (flipY) oriented = flipClip(oriented, "y");
      const source = rectangleStampSource(clip, { x, y, flip: { x: flipX, y: flipY } }, region, thickness);
      let any = false;
      for (let layerIndex = 0; layerIndex < clip.layers.length; layerIndex++) {
        for (let i = 0; i < 6; i++) {
          const expected = rectangleBandContains(region, thickness, x + i % 3, y + Math.floor(i / 3)) ? oriented.layers[layerIndex]!.cells[i]! : 0;
          if (expected) any = true;
          expect(source?.layers[layerIndex]!.cells[i] ?? 0).toBe(expected);
        }
      }
      expect(source !== null).toBe(any);
      expect([...clip.layers[0]!.cells]).toEqual([1, makeCell(1, FLIP_H), 1, 1, 1, makeCell(1, FLIP_D)]);
    }));
  });
});
