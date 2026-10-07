import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { displayToCore, dropIndex, rowShift } from "./layerOrder";

describe("layer panel order", () => {
  it("maps display (top first) to core (bottom first) indices and back", () => {
    expect(displayToCore(0, 3)).toBe(2);
    expect(displayToCore(2, 3)).toBe(0);
    fc.assert(fc.property(fc.integer({ min: 1, max: 50 }), fc.nat(), (count, i) => {
      const d = i % count;
      expect(displayToCore(displayToCore(d, count), count)).toBe(d);
    }));
  });

  it("rounds the drag distance to whole rows and clamps to the list", () => {
    expect(dropIndex(1, 0, 32, 4)).toBe(1);
    expect(dropIndex(1, 15, 32, 4)).toBe(1);
    expect(dropIndex(1, 17, 32, 4)).toBe(2);
    expect(dropIndex(1, -40, 32, 4)).toBe(0);
    expect(dropIndex(1, 1000, 32, 4)).toBe(3);
    expect(dropIndex(2, -1000, 32, 4)).toBe(0);
  });

  it("slides the rows between source and target to make room", () => {
    // Dragging row 0 down to 2: rows 1 and 2 move up.
    expect([0, 1, 2, 3].map((i) => rowShift(i, 0, 2, 32))).toEqual([0, -32, -32, 0]);
    // Dragging row 3 up to 1: rows 1 and 2 move down.
    expect([0, 1, 2, 3].map((i) => rowShift(i, 3, 1, 32))).toEqual([0, 32, 32, 0]);
    expect([0, 1, 2].map((i) => rowShift(i, 1, 1, 32))).toEqual([0, 0, 0]);
  });

  it("shifted rows end up exactly at the order a move produces", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.nat(), fc.nat(), (count, a, b) => {
        const from = a % count;
        const to = b % count;
        const order = [...Array(count).keys()];
        const moved = [...order];
        moved.splice(to, 0, ...moved.splice(from, 1));
        // Visual slot of every row = index + shift / row height (the dragged row lands on `to`).
        const visual = order.map((i) => (i === from ? to : i + rowShift(i, from, to, 1)));
        for (let slot = 0; slot < count; slot++) expect(order[visual.indexOf(slot)]).toBe(moved[slot]);
      }),
    );
  });
});
