import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { BAR_GAP, BAR_MARGIN, placeSelectionBar } from "./placement";

const bar = { width: 200, height: 36 };
const view = { width: 800, height: 600 };

describe("placeSelectionBar", () => {
  it("sits centred below the selection", () => {
    const p = placeSelectionBar({ x: 300, y: 100, width: 100, height: 50 }, bar, view);
    expect(p).toEqual({ x: 250, y: 150 + BAR_GAP, side: "below" });
  });

  it("flips above near the bottom edge", () => {
    const p = placeSelectionBar({ x: 300, y: 500, width: 100, height: 80 }, bar, view);
    expect(p.side).toBe("above");
    expect(p.y).toBe(500 - BAR_GAP - bar.height);
  });

  it("stays inside the view horizontally", () => {
    expect(placeSelectionBar({ x: -50, y: 10, width: 60, height: 20 }, bar, view).x).toBe(BAR_MARGIN);
    expect(placeSelectionBar({ x: 780, y: 10, width: 60, height: 20 }, bar, view).x).toBe(view.width - bar.width - BAR_MARGIN);
  });

  it("falls back to the top centre without a selection rect", () => {
    expect(placeSelectionBar(null, bar, view)).toEqual({ x: 300, y: BAR_MARGIN, side: "fallback" });
  });

  it("pins to the roomier edge when the selection fills the view", () => {
    const p = placeSelectionBar({ x: 0, y: -10, width: 800, height: 590 }, bar, view);
    expect(p.side).toBe("overlap");
    expect(p.y).toBe(view.height - bar.height - BAR_MARGIN);
  });

  it("never covers the selection when there is room above or below", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -400, max: 1200 }),
        fc.integer({ min: -400, max: 1000 }),
        fc.integer({ min: 1, max: 900 }),
        fc.integer({ min: 1, max: 700 }),
        (x, y, width, height) => {
          const sel = { x, y, width, height };
          const p = placeSelectionBar(sel, bar, view);
          // Always inside the view.
          expect(p.x).toBeGreaterThanOrEqual(BAR_MARGIN);
          expect(p.x + bar.width).toBeLessThanOrEqual(view.width - BAR_MARGIN);
          if (p.side === "overlap") return;
          expect(p.y).toBeGreaterThanOrEqual(BAR_MARGIN);
          expect(p.y + bar.height).toBeLessThanOrEqual(view.height - BAR_MARGIN);
          const overlapsY = p.y < y + height && p.y + bar.height > y;
          expect(overlapsY).toBe(false);
        },
      ),
    );
  });
});
