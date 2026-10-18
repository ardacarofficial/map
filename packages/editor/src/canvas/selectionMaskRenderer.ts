import type { SelectionRect } from "@smap/core";
import { BufferImageSource, Container, Mesh, MeshGeometry, Texture } from "pixi.js";
import { CANVAS_COLORS } from "./colors";
import { releaseTexture } from "./releaseTexture";
import { selectionBoundaryQuads, selectionOutline, type SelectionOutlineView } from "./selectionOutline";

type Rect = { x: number; y: number; width: number; height: number };

/** Cached screen-space fill/halo and boundary meshes. Ant frames upload only eight texels. */
export class SelectionMaskRenderer {
  readonly root = new Container();
  readonly #pixels = new Uint8Array(8 * 4);
  readonly #texture = new Texture({ source: new BufferImageSource({
    resource: this.#pixels, width: 8, height: 1, format: "rgba8unorm",
    scaleMode: "nearest", addressMode: "repeat", autoGenerateMipmaps: false,
  }) });
  #mask: Uint8Array | undefined;
  #key = "";
  #phase = -1;

  constructor() {
    this.root.visible = false;
  }

  set(r: SelectionRect, view: SelectionOutlineView, accent: number, phase: number): void {
    const key = `${Object.values(view).join(":")}:${r.width}:${r.height}:${accent}`;
    if (this.#mask !== r.mask || this.#key !== key) {
      this.reset();
      this.#mask = r.mask;
      this.#key = key;
      const outline = selectionOutline(r);
      const { x, y, tileWidth: tw, tileHeight: th, width, height, resolution: res } = view;
      const fills: Rect[] = [];
      for (const run of outline.runs) {
        const x0 = Math.max(0, x + run.x * tw), y0 = Math.max(0, y + run.y * th);
        const x1 = Math.min(width, x + (run.x + run.width) * tw), y1 = Math.min(height, y + (run.y + 1) * th);
        if (x1 > x0 && y1 > y0) fills.push({ x: x0 / res, y: y0 / res, width: (x1 - x0) / res, height: (y1 - y0) / res });
      }
      this.#rects(fills, accent, CANVAS_COLORS.regionFillAlpha);
      // Rectangular masks retain the old per-edge compositing at their corners.
      if (outline.edges.length === 4) {
        for (const edge of outline.edges) this.#boundary(selectionBoundaryQuads([edge], view));
      } else this.#boundary(selectionBoundaryQuads(outline.edges, view));
    }
    phase %= 8;
    if (this.#phase !== phase) {
      this.#phase = phase;
      for (let i = 0; i < 8; i++) this.#pixels.fill((i - phase + 8) % 8 < 4 ? 255 : 0, i * 4, i * 4 + 4);
      this.#texture.source.update();
    }
    this.root.visible = true;
  }

  /** Rectangles are already quads; skip Graphics path construction and tessellation entirely. */
  #rects(rects: readonly Rect[], tint: number, alpha: number): void {
    if (!rects.length) return;
    const positions = new Float32Array(rects.length * 8), indices = new Uint32Array(rects.length * 6);
    for (let i = 0; i < rects.length; i++) {
      const { x, y, width: w, height: h } = rects[i]!;
      positions.set([x, y, x + w, y, x + w, y + h, x, y + h], i * 8);
      const p = i * 4;
      indices.set([p, p + 1, p + 2, p, p + 2, p + 3], i * 6);
    }
    this.#addMesh(new MeshGeometry({ positions, uvs: new Float32Array(positions.length).fill(0.5), indices }), Texture.WHITE, tint, alpha);
  }

  #boundary(boundary: ReturnType<typeof selectionBoundaryQuads>): void {
    this.#rects(boundary.shadows, CANVAS_COLORS.cursorShadow, 0.9);
    if (boundary.indices.length) this.#addMesh(new MeshGeometry({ positions: boundary.positions, uvs: boundary.uvs, indices: boundary.indices }), this.#texture, CANVAS_COLORS.cursor, 0.95);
  }

  #addMesh(geometry: MeshGeometry, texture: Texture, tint: number, alpha: number): void {
    // Share the warmed batch shader: a separate mesh shader stalls the first selection frame.
    geometry.batchMode = "batch";
    this.root.addChild(new Mesh({ geometry, texture, tint, alpha, roundPixels: false }));
  }

  reset(): void {
    for (const child of [...this.root.children]) {
      const mesh = child as Mesh, geometry = mesh.geometry;
      mesh.destroy();
      geometry.destroy(true);
    }
    this.#mask = undefined;
    this.#key = "";
    this.root.visible = false;
  }

  destroy(): void {
    this.reset();
    this.root.destroy({ children: true });
    releaseTexture(this.#texture);
  }
}
