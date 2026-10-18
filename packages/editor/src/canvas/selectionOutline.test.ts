import { describe, expect, it } from "vitest";
import { selectionOutline, selectionBoundaryQuads } from "./selectionOutline";
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

describe("selection boundary mesh", () => {
  it("uses one quad per comb edge regardless of zoom or dash count", () => {
    const mask = Uint8Array.from({ length: 40000 }, (_, i) => i % 200 === 0 || Math.floor(i / 200) % 2 === 0 ? 1 : 0);
    const r = { x: 0, y: 0, width: 200, height: 200, mask };
    const o = selectionOutline(r);
    expect(o.edges).toHaveLength(402);
    for (const scale of [3.2, 32]) {
      const mesh = selectionBoundaryQuads(o.edges, { x: 20, y: 20, tileWidth: scale, tileHeight: scale, width: 7000, height: 7000, lineWidth: 1, resolution: 1 });
      expect(mesh.positions).toHaveLength(402 * 8);
      expect(mesh.indices).toHaveLength(402 * 6);
      expect(mesh.uvs[2]! - mesh.uvs[0]!).toBeCloseTo(200 * scale / 8);
    }
  });

  it("clips both axes while preserving dash phase relative to the unclipped edge", () => {
    const mesh = selectionBoundaryQuads([{ x0: 0, y0: 0, x1: 10, y1: 0 }, { x0: 0, y0: 0, x1: 0, y1: 10 }, { x0: 0, y0: 100, x1: 10, y1: 100 }],
      { x: -10, y: 6, tileWidth: 4, tileHeight: 8, width: 20, height: 30, lineWidth: 2, resolution: 2 });
    expect(Array.from(mesh.positions)).toEqual([-1, 3, 11, 3, 11, 4, -1, 4]);
    expect(Array.from(mesh.uvs)).toEqual([0.5, 0, 2, 0, 2, 1, 0.5, 1]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("keeps independent horizontal and vertical hole edges", () => {
    const o = selectionOutline({ x: 0, y: 0, width: 3, height: 3, mask: Uint8Array.of(1, 1, 1, 1, 0, 1, 1, 1, 1) });
    const mesh = selectionBoundaryQuads(o.edges, { x: 0, y: 0, tileWidth: 16, tileHeight: 32, width: 100, height: 100, lineWidth: 1, resolution: 1 });
    expect(mesh.indices).toHaveLength(8 * 6);
    // Vertical edges also advance U (the repeating texture is eight texels wide).
    expect(Array.from(mesh.uvs.slice(-8))).toEqual([0, 0, 0, 1, 12, 1, 12, 0]);
  });
});
