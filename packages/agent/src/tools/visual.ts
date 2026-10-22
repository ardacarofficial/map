/** Strict pixel lookup only: no screenshot segmentation, fuzzy scores or filesystem access. */
import { FLIP_D, FLIP_H, FLIP_V, placedToSourcePixel, type RgbaImage, type Tileset } from "@smap/core";
import { AgentError, AgentErrorCode, type ReferenceCandidate, type ReferenceMatches } from "../contracts";

export const VISUAL_LIMITS = {
  references: 32, tilesets: 32, topK: 32, maxScale: 8,
  comparisons: 100000, pixelComparisons: 8 * 1024 * 1024,
  checkpointPixels: 16384,
} as const;

export interface VisualMatchSource { tileset: Tileset; pixels: RgbaImage }
export interface VisualSearchOptions {
  topK: number; maxScale: number; revision: number;
  /** Must yield to the host event loop and check cancellation/deadline. */
  checkpoint(): Promise<void>;
}

/** A call-scoped search shares its work budget across every atlas. */
export class ExactReferenceSearch {
  readonly #candidates: ReferenceCandidate[] = [];
  readonly #seen = new Set<string>();
  #comparisons = 0;
  #pixels = 0;
  #truncated = false;
  constructor(readonly reference: RgbaImage, readonly options: VisualSearchOptions) {}

  get complete(): boolean { return this.#truncated; }

  async addSource({ tileset: t, pixels }: VisualMatchSource): Promise<void> {
    if (this.complete) return;
    const count = t.edited?.nextTileId ?? t.columns * t.rows;
    for (let scale = 1; scale <= this.options.maxScale; scale++) {
      if (this.reference.width % scale || this.reference.height % scale) continue;
      const placedWidth = this.reference.width / scale, placedHeight = this.reference.height / scale;
      for (let orientation = 0; orientation < 8; orientation++) {
        const transpose = !!(orientation & 4);
        const width = transpose ? placedHeight : placedWidth, height = transpose ? placedWidth : placedHeight;
        if (width % t.tileWidth || height % t.tileHeight) continue;
        const cols = width / t.tileWidth, rows = height / t.tileHeight;
        if (cols > t.columns || rows > t.rows) continue;
        const flags = ((orientation & 1 ? FLIP_H : 0) | (orientation & 2 ? FLIP_V : 0) | (transpose ? FLIP_D : 0)) >>> 0;
        for (let y = 0; y <= t.rows - rows; y++) for (let x = 0; x <= t.columns - cols; x++) {
          if ((y + rows - 1) * t.columns + x + cols - 1 >= count) continue;
          const key = JSON.stringify([t.id, x, y, cols, rows, scale]);
          if (this.#seen.has(key)) continue; // Symmetric orientations use their lowest compact D4 flag.
          if (++this.#comparisons > VISUAL_LIMITS.comparisons) this.exceeded();
          if (this.#comparisons % 256 === 0) await this.options.checkpoint();
          const lastX = t.margin + (x + cols - 1) * (t.tileWidth + t.spacing) + t.tileWidth;
          const lastY = t.margin + (y + rows - 1) * (t.tileHeight + t.spacing) + t.tileHeight;
          if (lastX > pixels.width || lastY > pixels.height) throw new AgentError(AgentErrorCode.SOURCE_CHANGED, "Atlas region exceeds current source image");
          if (!await this.equal(pixels, t, x, y, width, height, flags, scale)) continue;
          this.#seen.add(key);
          if (this.#candidates.length === this.options.topK) { this.#truncated = true; return; }
          this.#candidates.push({
            tilesetId: t.id, tileId: y * t.columns + x,
            region: { x, y, width: cols, height: rows },
            flags: orientation as ReferenceCandidate["flags"], scale, match: "exact_rgba",
          });
        }
      }
    }
  }

  result(): ReferenceMatches {
    return {
      status: this.#truncated || this.#candidates.length > 1 ? "ambiguous" : this.#candidates.length ? "matched" : "no_match",
      candidates: this.#candidates, truncated: this.#truncated, revision: this.options.revision,
    };
  }

  private exceeded(): never {
    throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED, "Exact reference search budget exceeded; narrow the tileset selection or use a smaller reference");
  }

  private async equal(source: RgbaImage, t: Tileset, col: number, row: number, width: number, height: number, flags: number, scale: number): Promise<boolean> {
    for (let y = 0; y < this.reference.height; y++) for (let x = 0; x < this.reference.width; x++) {
      if (++this.#pixels > VISUAL_LIMITS.pixelComparisons) this.exceeded();
      if (this.#pixels % VISUAL_LIMITS.checkpointPixels === 0) await this.options.checkpoint();
      const p = placedToSourcePixel({ x: Math.floor(x / scale), y: Math.floor(y / scale) }, width, height, flags);
      const sx = t.margin + (col + Math.floor(p.x / t.tileWidth)) * (t.tileWidth + t.spacing) + p.x % t.tileWidth;
      const sy = t.margin + (row + Math.floor(p.y / t.tileHeight)) * (t.tileHeight + t.spacing) + p.y % t.tileHeight;
      const a = (y * this.reference.width + x) * 4, b = (sy * source.width + sx) * 4;
      const alpha = this.reference.data[a + 3];
      if (alpha !== source.data[b + 3]) return false;
      // Canonical RGBA treats hidden RGB as zero; partial alpha stays straight and exact.
      if (alpha && (this.reference.data[a] !== source.data[b] || this.reference.data[a + 1] !== source.data[b + 1] || this.reference.data[a + 2] !== source.data[b + 2])) return false;
    }
    return true;
  }
}
