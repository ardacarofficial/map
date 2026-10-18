import { Mesh, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { SelectionMaskRenderer } from "./selectionMaskRenderer";

const region = { x: 0, y: 0, width: 2, height: 2, mask: Uint8Array.of(1, 1, 1, 0) };
const view = { x: 20, y: 20, tileWidth: 16, tileHeight: 16, width: 300, height: 300, lineWidth: 1, resolution: 1 };
const ants = (r: SelectionMaskRenderer) => r.root.children.find(c => c instanceof Mesh && c.texture.source.width === 8) as Mesh;

describe("cached mask rendering", () => {
  it("keeps the large comb on the warmed batch shader for its first frame", () => {
    const renderer = new SelectionMaskRenderer();
    const mask = Uint8Array.from({ length: 40000 }, (_, i) => i % 200 === 0 || Math.floor(i / 200) % 2 === 0 ? 1 : 0);
    renderer.set({ x: 0, y: 0, width: 200, height: 200, mask }, { ...view, tileWidth: 3.2, tileHeight: 3.2, width: 700, height: 700 }, 0x69c9ae, 0);
    expect(ants(renderer).batched).toBe(true);
    renderer.destroy();
  });

  it("preserves the per-edge halo/ant compositing order for rectangular masks", () => {
    const renderer = new SelectionMaskRenderer();
    renderer.set({ ...region, mask: new Uint8Array(4).fill(1) }, view, 0x69c9ae, 4);
    const children = renderer.root.children as Mesh[];
    expect(children).toHaveLength(9);
    for (let i = 1; i < children.length; i += 2) {
      expect(children[i]!.texture).toBe(Texture.WHITE);
      expect(children[i]!.alpha).toBe(0.9);
      expect(children[i + 1]!.texture.source.width).toBe(8);
      expect(children[i + 1]!.alpha).toBe(0.95);
    }
    renderer.destroy();
  });

  it("reuses tessellated geometry through every ant phase and updates only the tiny texture", () => {
    const renderer = new SelectionMaskRenderer();
    renderer.set(region, view, 0x69c9ae, 0);
    expect(renderer.root.children.every(c => c instanceof Mesh)).toBe(true);
    const mesh = ants(renderer), geometry = mesh.geometry;
    const pixels = mesh.texture.source.resource as Uint8Array;
    expect(Array.from(pixels.filter((_, i) => i % 4 === 3))).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
    for (let phase = 1; phase <= 8; phase++) {
      renderer.set(region, view, 0x69c9ae, phase);
      expect(ants(renderer)).toBe(mesh);
      expect(mesh.geometry).toBe(geometry);
      expect(pixels[(phase % 8) * 4 + 3]).toBe(255);
      expect(pixels[((phase + 4) % 8) * 4 + 3]).toBe(0);
    }
    renderer.destroy();
  });

  it("rebuilds after a camera, mask or colour change and releases replaced geometry", () => {
    const renderer = new SelectionMaskRenderer();
    renderer.set(region, view, 0x69c9ae, 0);
    let old = ants(renderer).geometry;
    let buffers = [...old.buffers];
    for (const [r, v, color] of [
      [region, { ...view, x: 21 }, 0x69c9ae],
      [{ ...region, mask: Uint8Array.of(1, 0, 1, 1) }, view, 0x69c9ae],
      [region, view, 0xffffff],
    ] as const) {
      renderer.set(r, v, color, 0);
      expect(ants(renderer).geometry).not.toBe(old);
      expect(buffers.every(b => b.destroyed)).toBe(true);
      old = ants(renderer).geometry;
      buffers = [...old.buffers];
    }
    renderer.reset();
    expect(renderer.root.visible).toBe(false);
    expect(renderer.root.children).toHaveLength(0);
    renderer.set(region, view, 0x69c9ae, 3);
    expect(renderer.root.visible).toBe(true);
    renderer.destroy();
  });
});
