import type { TileClip } from "../src/clip";

export function source(width = 3, height = 3): TileClip {
  return { width, height, palette: Array.from({ length: width * height }, (_, tileId) => ({ tilesetId: "source", tileId })), layers: [{ layerId: "s", name: "Road", cells: Uint32Array.from({ length: width * height }, (_, i) => i + 1) }] };
}
