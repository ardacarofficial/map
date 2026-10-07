/**
 * World-space preview display objects: a tile preview mesh (stamps,
 * rectangles) and the fill-region highlight (one sprite, one pixel per cell).
 * Both rebuild only when their content key changes.
 */
import { CanvasSource, Container, Mesh, MeshGeometry, Sprite, Texture } from "pixi.js";

import type { CellMaskImage } from "./cellMask";
import { buildCellQuads, type CellQuad } from "./chunkGeometry";

/** Semi-transparent tiles drawn from atlas pages. */
export class TilePreview {
  readonly root = new Container();
  #key: string | null = null;

  constructor(alpha: number) {
    this.root.alpha = alpha;
    this.root.visible = false;
  }

  get key(): string | null {
    return this.#key;
  }

  /** Rebuilds the meshes from `cells` (positions in cells, relative to `root`). */
  set(key: string, cells: readonly CellQuad[], tileW: number, tileH: number, texture: (group: number) => Texture | undefined): void {
    this.#clearMeshes();
    this.#key = key;
    for (const b of buildCellQuads(cells, tileW, tileH)) {
      const tex = texture(b.group);
      if (!tex) continue;
      const geometry = new MeshGeometry({ positions: b.positions, uvs: b.uvs, indices: b.indices });
      this.root.addChild(new Mesh({ geometry, texture: tex, roundPixels: false }));
    }
  }

  invalidate(): void {
    this.#clearMeshes();
    this.#key = null;
  }

  destroy(): void {
    this.#clearMeshes();
    this.root.destroy({ children: true });
  }

  #clearMeshes(): void {
    for (const child of [...this.root.children]) {
      if (child instanceof Mesh) {
        const geometry = child.geometry;
        child.destroy();
        geometry.destroy();
      } else child.destroy();
    }
  }
}

/** The cells a fill would cover, as one tinted, nearest-filtered sprite. */
export class MaskPreview {
  readonly sprite = new Sprite();
  #image: CellMaskImage | null = null;

  constructor(tint: number, alpha: number) {
    this.sprite.tint = tint;
    this.sprite.alpha = alpha;
    this.sprite.visible = false;
  }

  get image(): CellMaskImage | null {
    return this.#image;
  }

  /** Shows `image` (or hides on null) scaled to `tileW`×`tileH` per cell. */
  set(image: CellMaskImage | null, tileW: number, tileH: number): void {
    if (image === this.#image) return;
    this.#releaseTexture();
    this.#image = image;
    if (!image) {
      this.sprite.visible = false;
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
    this.sprite.texture = new Texture({
      source: new CanvasSource({ resource: canvas, scaleMode: "nearest", autoGenerateMipmaps: false, antialias: false }),
    });
    this.sprite.position.set(image.x * tileW, image.y * tileH);
    this.sprite.width = image.width * tileW;
    this.sprite.height = image.height * tileH;
  }

  destroy(): void {
    this.#releaseTexture();
    this.sprite.destroy();
  }

  #releaseTexture(): void {
    const tex = this.sprite.texture;
    if (tex && tex !== Texture.EMPTY) {
      this.sprite.texture = Texture.EMPTY;
      tex.destroy(true);
    }
  }
}
