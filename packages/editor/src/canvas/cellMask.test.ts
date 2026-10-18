import { floodFill, floodFillRuns } from "@smap/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { cellMaskImage, membershipMask, runMaskImage, runMembershipMask } from "./cellMask";

describe("run preview masks", () => {
  it("matches every cropped RGBA pixel and membership bit of point previews", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 40 }),
      fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1600, maxLength: 1600 }),
      fc.integer({ min: -2, max: 42 }), fc.integer({ min: -2, max: 42 }), fc.integer({ min: 0, max: 4 }),
      (width, height, values, x, y, value) => {
        const layer = { getCell: (cx: number, cy: number) => values[cy * 40 + cx]! };
        const bounds = { width, height };
        const points = floodFill(layer, x, y, value, bounds);
        const runs = floodFillRuns(layer, x, y, value, bounds);
        expect(runMaskImage(runs)).toEqual(cellMaskImage(points));
        expect(runMembershipMask(runs, width, height)).toEqual(membershipMask(points, width, height));
      },
    ), { numRuns: 200 });
  });

  it("preserves holes and disconnected cropped rows", () => {
    const runs = [{ y: 4, left: 3, right: 5 }, { y: 6, left: 4, right: 4 }];
    const image = runMaskImage(runs)!;
    expect([image.x, image.y, image.width, image.height]).toEqual([3, 4, 3, 3]);
    expect([...image.data.filter((_, i) => i % 4 === 3)]).toEqual([255, 255, 255, 0, 0, 0, 0, 255, 0]);
  });
});
