import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { BAR_GAP, BAR_MARGIN, placeSelectionBar, type Rect } from "./placement";

const bar = { width: 200, height: 36 };
const view = { width: 800, height: 600 };

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const barRect = (p: { x: number; y: number }): Rect => ({ x: p.x, y: p.y, width: bar.width, height: bar.height });

describe("placeSelectionBar", () => {
  it("sits centred below the selection", () => {
    const p = placeSelectionBar({ x: 300, y: 100, width: 100, height: 50 }, bar, view);
    expect(p).toEqual({ x: 250, y: 150 + BAR_GAP, side: "below" });
  });

  it("stays below a selection at the very top edge (never on top of it)", () => {
    const sel = { x: 20, y: 0, width: 180, height: 48 };
    const p = placeSelectionBar(sel, bar, view);
    expect(p.side).toBe("below");
    expect(p.y).toBe(48 + BAR_GAP);
    expect(overlaps(barRect(p), sel)).toBe(false);
  });

  it("flips above near the bottom edge", () => {
    const p = placeSelectionBar({ x: 300, y: 500, width: 100, height: 80 }, bar, view);
    expect(p.side).toBe("above");
    expect(p.y).toBe(500 - BAR_GAP - bar.height);
  });

  it("goes beside a selection too tall for above and below", () => {
    const tall = { x: 100, y: 20, width: 160, height: 560 };
    const p = placeSelectionBar(tall, bar, view);
    expect(p.side).toBe("right");
    expect(p.x).toBe(260 + BAR_GAP);
    expect(p.y).toBe(Math.round(300 - bar.height / 2));
    expect(overlaps(barRect(p), tall)).toBe(false);
    // No room on the right: on the left.
    const atRight = { x: 500, y: 20, width: 280, height: 560 };
    const q = placeSelectionBar(atRight, bar, view);
    expect(q.side).toBe("left");
    expect(q.x).toBe(500 - BAR_GAP - bar.width);
    expect(overlaps(barRect(q), atRight)).toBe(false);
  });

  it("stays inside the view horizontally", () => {
    expect(placeSelectionBar({ x: -50, y: 10, width: 60, height: 20 }, bar, view).x).toBe(BAR_MARGIN);
    expect(placeSelectionBar({ x: 780, y: 10, width: 60, height: 20 }, bar, view).x).toBe(view.width - bar.width - BAR_MARGIN);
  });

  it("falls back to the top centre without a selection rect", () => {
    expect(placeSelectionBar(null, bar, view)).toEqual({ x: 300, y: BAR_MARGIN, side: "fallback" });
  });

  it("slides left of the minimap corner when it would sit on it", () => {
    const corner = { width: 226, height: 176 };
    // Below a selection whose bar would land on the minimap.
    const sel = { x: 600, y: 380, width: 150, height: 40 };
    const plain = placeSelectionBar(sel, bar, view);
    expect(plain.x + bar.width).toBeGreaterThan(view.width - corner.width);
    const p = placeSelectionBar(sel, bar, view, BAR_GAP, BAR_MARGIN, corner);
    expect(p.side).toBe("below");
    expect(p.x + bar.width).toBeLessThanOrEqual(view.width - corner.width);
    expect(overlaps(barRect(p), sel)).toBe(false);
    // Clear of the box already: unchanged.
    const high = { x: 600, y: 50, width: 150, height: 40 };
    expect(placeSelectionBar(high, bar, view, BAR_GAP, BAR_MARGIN, corner)).toEqual(placeSelectionBar(high, bar, view));
  });

  it("pins inside the roomier edge only when the selection fills the view", () => {
    const p = placeSelectionBar({ x: 0, y: -10, width: 800, height: 590 }, bar, view);
    expect(p.side).toBe("overlap");
    expect(p.y).toBe(view.height - bar.height - BAR_MARGIN);
  });

  it("never covers the selection unless it leaves no room on any side", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -400, max: 1200 }),
        fc.integer({ min: -400, max: 1000 }),
        fc.integer({ min: 1, max: 900 }),
        fc.integer({ min: 1, max: 700 }),
        fc.boolean(),
        (x, y, width, height, withCorner) => {
          const sel = { x, y, width, height };
          const p = placeSelectionBar(sel, bar, view, BAR_GAP, BAR_MARGIN, withCorner ? { width: 226, height: 176 } : null);
          // Always inside the view.
          expect(p.x).toBeGreaterThanOrEqual(BAR_MARGIN);
          expect(p.x + bar.width).toBeLessThanOrEqual(view.width - BAR_MARGIN);
          expect(p.y).toBeGreaterThanOrEqual(BAR_MARGIN);
          expect(p.y + bar.height).toBeLessThanOrEqual(view.height - BAR_MARGIN);
          if (p.side === "overlap") {
            // Only when no side had room for the bar plus gap and margin.
            const room = (n: number, size: number) => n >= size + BAR_GAP + BAR_MARGIN;
            expect(room(view.height - (y + height), bar.height)).toBe(false);
            expect(room(y, bar.height)).toBe(false);
            expect(room(view.width - (x + width), bar.width)).toBe(false);
            expect(room(x, bar.width)).toBe(false);
            return;
          }
          expect(overlaps(barRect(p), sel)).toBe(false);
        },
      ),
    );
  });
});
