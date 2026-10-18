import { describe, expect, it } from "vitest";
import { selectionOutline } from "./selectionOutline";
describe("selection outline", () => {
  it("outlines the hole as well as the outside, merges runs and does not draw internal edges", () => {
    const mask = Uint8Array.of(1, 1, 1, 0);
    const o = selectionOutline({ x: 0, y: 0, width: 2, height: 2, mask });
    expect(o.runs).toEqual([{ x: 0, y: 0, width: 2 }, { x: 0, y: 1, width: 1 }]);
    expect(o.edges).toHaveLength(6);
    expect(o.edges.reduce((sum, e) => sum + Math.abs(e.x1 - e.x0) + Math.abs(e.y1 - e.y0), 0)).toBe(8);
  });
  it("draws an enclosed hole independently of the outer boundary", () => {
    const o = selectionOutline({ x: 10, y: 10, width: 3, height: 3, mask: Uint8Array.of(1, 1, 1, 1, 0, 1, 1, 1, 1) });
    expect(o.edges).toHaveLength(8);
    expect(o.edges.reduce((sum, e) => sum + Math.abs(e.x1 - e.x0) + Math.abs(e.y1 - e.y0), 0)).toBe(16);
  });
  it("200 by 200 uniform area has four outline segments", () => {
    expect(selectionOutline({ x: 0, y: 0, width: 200, height: 200, mask: new Uint8Array(40000).fill(1) }).edges).toHaveLength(4);
  });
});
