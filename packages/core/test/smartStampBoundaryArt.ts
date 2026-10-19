import type { NineSliceSelectionInput } from "../src/smartStamp/detect";

export type BoundaryMaterial = "stone" | "plank" | "grass" | "road" | "wall" | "water";
/** Exact integer hash from review/boundary-round2.mjs. */
export function materialHash(n: number): number {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}
/** Review stone floor, plus bounded road/wall/water and other seam-continuous materials.
 * Seed 0 bounded art matches the review's positive generator; other seeds vary pixel grain.
 * Orientation is compact D4 (transpose, H, V), independent of core's addressing helpers.
 */
export function boundaryArt(seed: number, w = 6, h = 6, size = 16, material: BoundaryMaterial = "stone", border = 0, orientation = 0, grid: { col?: number; row?: number; margin?: number; spacing?: number; columns?: number; rows?: number } = {}): NineSliceSelectionInput {
  const W = w * size, H = h * size, dw = orientation & 1 ? h : w, dh = orientation & 1 ? w : h;
  const { col = 0, row = 0, margin = 0, spacing = 0, columns = col + dw, rows = row + dh } = grid;
  const width = 2 * margin + columns * size + (columns - 1) * spacing, height = 2 * margin + rows * size + (rows - 1) * spacing;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const tx = Math.floor(x / size), ty = Math.floor(y / size), px = x % size, py = y % size;
    let rgb: number[];
    if (border) {
      const d = Math.min(x, y, W - 1 - x, H - 1 - y), v = Math.min(180, 40 + Math.floor(d * 140 / (border * size)));
      const grain = seed === 0 ? (px * 13 + py * 7) % 5 : materialHash(seed + x * 733 + y * 977) % 5;
      rgb = material === "water" ? [v / 3, v * .7 + grain, v + grain] : material === "wall" ? [v + grain, v * .8, v * .6] : [v + grain, v + grain, v + grain];
    } else {
      const v = 30 + materialHash(seed * w * h + ty * w + tx) % 180;
      const grain = material === "plank" ? (px * 5 + py * 2) % 7 : material === "grass" ? materialHash(seed * 19 + x * 7 + y * 11) % 7 : (px * 11 + py * 17) % 7;
      rgb = material === "plank" ? [v + 20 + grain, v * .7 + grain, v * .4] : material === "grass" ? [v / 2 + grain, v + grain, v / 3] : [v + grain, v + grain, v + grain];
      if (px === 0 || py === 0 || px === size - 1 || py === size - 1) rgb = [120, 120, 120];
    }
    let dx = x, dy = y;
    if (orientation & 1) [dx, dy] = [dy, dx];
    if (orientation & 2) dx = dw * size - 1 - dx;
    if (orientation & 4) dy = dh * size - 1 - dy;
    const sx = margin + (col + Math.floor(dx / size)) * (size + spacing) + dx % size;
    const sy = margin + (row + Math.floor(dy / size)) * (size + spacing) + dy % size;
    data.set([...rgb, 255], (sy * width + sx) * 4);
  }
  return { tileset: { id: "material", columns, rows, tileWidth: size, tileHeight: size, margin, spacing }, rect: { col, row, width: dw, height: dh }, ids: Array.from({ length: dw * dh }, (_, i) => (row + Math.floor(i / dw)) * columns + col + i % dw), emptyIds: new Set(), pixels: { width, height, data } };
}
