import { layerDrawList } from "@smap/core";
import { describe, expect, it } from "vitest";

import {
  compositeOps,
  largestFittingScale,
  opsTilesets,
  PNG_MAX_SIDE,
  pngFits,
  tileTransform,
  type CanvasOp,
  type Transform,
} from "./pngComposite";
import { replayOps, type Replay2D } from "./pngRender";
import { sampleStore } from "./testDoc";

/** Where the transform sends a tile-local point. */
function apply([a, b, c, d, e, f]: Transform, x: number, y: number): [number, number] {
  return [a * x + c * y + e, b * x + d * y + f];
}

describe("tileTransform", () => {
  it("places an unflipped tile at its scaled cell", () => {
    expect(tileTransform(32, 16, 16, 16, false, false, 2)).toEqual([2, 0, 0, 2, 64, 32]);
  });

  it("mirrors a horizontally flipped tile inside its own rectangle", () => {
    const m = tileTransform(32, 16, 16, 16, true, false, 2);
    expect(apply(m, 0, 0)).toEqual([96, 32]); // local left edge → right edge of the cell
    expect(apply(m, 16, 16)).toEqual([64, 64]);
  });

  it("mirrors a vertically flipped tile inside its own rectangle", () => {
    const m = tileTransform(0, 0, 16, 16, false, true, 1);
    expect(apply(m, 0, 0)).toEqual([0, 16]);
    expect(apply(m, 16, 16)).toEqual([16, 0]);
  });

  it("flips both ways around the cell (a 180° turn)", () => {
    const m = tileTransform(16, 16, 16, 16, true, true, 4);
    expect(apply(m, 0, 0)).toEqual([128, 128]);
    expect(apply(m, 16, 16)).toEqual([64, 64]);
  });
});

describe("compositeOps", () => {
  it("draws visible layers bottom to top with their opacity, skipping hidden layers", () => {
    const { store } = sampleStore();
    const list = layerDrawList(store.document);
    expect(list.width).toBe(64);
    expect(list.height).toBe(48);
    const ops = compositeOps(list, 1);
    expect(ops.map((op) => (op.kind === "alpha" ? `alpha ${op.alpha}` : `draw ${op.tilesetId}`))).toEqual([
      "draw grass",
      "draw grass",
      "alpha 0.5",
      "draw grass2",
      "draw grass2",
      "draw grass2",
    ]);
    expect(opsTilesets(ops)).toEqual(new Set(["grass", "grass2"]));
  });

  it("uses the tile's source rectangle and the flip transforms", () => {
    const { store } = sampleStore();
    const draws = compositeOps(layerDrawList(store.document), 2).filter(
      (op): op is Extract<CanvasOp, { kind: "draw" }> => op.kind === "draw",
    );
    // grass tile 5 = col 1, row 1 → (16, 16); grass2 tile 2 = col 2, row 0 → (32, 0).
    expect(draws[0]).toMatchObject({ sx: 16, sy: 16, sw: 16, sh: 16, dw: 16, dh: 16, transform: [2, 0, 0, 2, 0, 0] });
    expect(draws[1]!.transform).toEqual([2, 0, 0, 2, 96, 64]); // (3, 2)
    expect(draws[2]).toMatchObject({ sx: 32, sy: 0, transform: [-2, 0, 0, 2, 64, 0] }); // (1, 0) flip H
    expect(draws[3]!.transform).toEqual([2, 0, 0, -2, 64, 64]); // (2, 1) flip V
    expect(draws[4]!.transform).toEqual([-2, 0, 0, -2, 128, 64]); // (3, 1) flip H+V
  });

  it("emits nothing for an empty map", () => {
    expect(compositeOps({ width: 32, height: 32, layers: [{ layerId: "a", opacity: 0.3, items: [] }] }, 1)).toEqual([]);
  });
});

describe("replayOps", () => {
  it("turns ops into canvas calls with smoothing off and resets state afterwards", () => {
    const { store } = sampleStore();
    const ops = compositeOps(layerDrawList(store.document), 1);
    const calls: string[] = [];
    const ctx: Replay2D = {
      globalAlpha: 1,
      imageSmoothingEnabled: true,
      setTransform: (...m) => calls.push(`T ${m.join(",")}`),
      drawImage: (image, ...rest) => calls.push(`D ${String(image)} ${rest.join(",")} @${ctx.globalAlpha}`),
    };
    // grass2 has no image: its tiles are skipped, the rest is drawn.
    replayOps(ctx, ops, (id) => (id === "grass" ? ("IMG" as unknown as CanvasImageSource) : undefined));
    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(ctx.globalAlpha).toBe(1);
    expect(calls).toEqual([
      "T 1,0,0,1,0,0",
      "D IMG 16,16,16,16,0,0,16,16 @1",
      "T 1,0,0,1,48,32",
      "D IMG 16,16,16,16,0,0,16,16 @1",
      "T 1,0,0,1,0,0",
    ]);
  });
});

describe("PNG size guard", () => {
  it("accepts sizes up to 16384 px per side", () => {
    expect(pngFits(PNG_MAX_SIDE, 1024, 1)).toBe(true);
    expect(pngFits(PNG_MAX_SIDE + 1, 1024, 1)).toBe(false);
    expect(pngFits(8192, 1024, 2)).toBe(true);
    expect(pngFits(8193, 1024, 2)).toBe(false);
  });

  it("rejects more than 256 MP even when both sides fit", () => {
    expect(pngFits(16384, 16384, 1)).toBe(true); // exactly 256 MP
    expect(pngFits(16384, 16385, 1)).toBe(false);
  });

  it("offers the largest scale that fits", () => {
    expect(largestFittingScale(2048, 1536)).toBe(4);
    expect(largestFittingScale(6000, 1000)).toBe(2);
    expect(largestFittingScale(10000, 1000)).toBe(1);
    expect(largestFittingScale(20000, 1000)).toBeNull();
  });
});
