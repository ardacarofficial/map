/** Manual collision; topmost nonzero grid value wins, including hidden layers. */
import { CHUNK_AREA, CHUNK_MASK, CHUNK_SHIFT } from "./chunk";
import type { MapDocument } from "./document";
import { COLLISION_PASSABLE, COLLISION_SOLID, isGridLayer } from "./layer";

/** Derived collision of a whole map. */
export interface CollisionGrid {
  readonly width: number;
  readonly height: number;
  /** `width × height`, row-major; 1 = solid, 0 = passable. */
  readonly data: Uint8Array;
}

/** True when cell (`x`, `y`) is solid. Cells outside the map are not solid. */
export function collisionAt(doc: MapDocument, x: number, y: number): boolean {
  if (!doc.inBounds(x, y)) return false;
  const layers = doc.layers;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]!;
    if (!isGridLayer(layer) || layer.role !== "collision") continue;
    const v = layer.getCell(x, y);
    if (v === COLLISION_SOLID) return true;
    if (v === COLLISION_PASSABLE) return false;
  }
  return false;
}

/** Collision of every cell of the map (same rules as {@link collisionAt}). */
export function deriveCollision(doc: MapDocument): CollisionGrid {
  const { width, height } = doc.map;
  const data = new Uint8Array(width * height);
  const forEachCell = (chunkData: Uint32Array, cx: number, cy: number, fn: (index: number, value: number) => void) => {
    const x0 = cx << CHUNK_SHIFT;
    const y0 = cy << CHUNK_SHIFT;
    for (let i = 0; i < CHUNK_AREA; i++) {
      const v = chunkData[i]!;
      if (v === 0) continue;
      const x = x0 + (i & CHUNK_MASK);
      const y = y0 + (i >> CHUNK_SHIFT);
      if (x >= 0 && y >= 0 && x < width && y < height) fn(y * width + x, v);
    }
  };
  // Manual values: bottom to top, so the topmost collision layer wins.
  for (const layer of doc.layers) {
    if (!isGridLayer(layer) || layer.role !== "collision") continue;
    for (const chunk of layer.chunks()) {
      forEachCell(chunk.data, chunk.cx, chunk.cy, (index, v) => {
        if (v === COLLISION_SOLID) data[index] = 1;
        else if (v === COLLISION_PASSABLE) data[index] = 0;
      });
    }
  }
  return { width, height, data };
}
