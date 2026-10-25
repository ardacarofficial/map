/** Synthetic tile pack for object tests: textured ground, transparent objects (crates, barrel, torch, net, bush),
 * a scene with stacked crates, and a hard reference (scaled, shifted, cropped, lit unevenly, noisy). */
import type { RgbaImage, Stamp, Tileset } from "@smap/core";
import { stampRgba } from "../raster";

export const T = 16;
const COLUMNS = 8, ROWS = 4;
export const pack: Tileset = { id: "pack", name: "Pack", imagePath: "tilesets/pack.png", tileWidth: T, tileHeight: T, columns: COLUMNS, rows: ROWS, margin: 0, spacing: 0 };

type RGB = readonly [number, number, number];
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Sheet with ground tiles 0–3 and object art from tile 8 on. */
export function packPixels(): RgbaImage {
  const width = COLUMNS * T, height = ROWS * T, data = new Uint8Array(width * height * 4);
  const put = (tile: number, x: number, y: number, c: RGB, a = 255) => {
    if (x < 0 || y < 0 || x >= T || y >= T) return;
    const p = (((Math.floor(tile / COLUMNS) * T + y) * width) + (tile % COLUMNS) * T + x) * 4;
    data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = a;
  };
  /** Draw in a w×h tile block whose top-left tile is `tile`. */
  const block = (tile: number, w: number, h: number, paint: (x: number, y: number) => RGB | null) => {
    for (let y = 0; y < h * T; y++) for (let x = 0; x < w * T; x++) {
      const c = paint(x, y);
      if (c) put(tile + Math.floor(y / T) * COLUMNS + Math.floor(x / T), x % T, y % T, c);
    }
  };
  const shade = (c: RGB, k: number): RGB => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
  // Ground: grass, dirt, stone floor, planks.
  block(0, 1, 1, (x, y) => shade([86, 156, 70], 0.85 + 0.3 * hash(x, y, 1)));
  block(1, 1, 1, (x, y) => shade([150, 112, 72], 0.85 + 0.3 * hash(x, y, 2)));
  block(2, 1, 1, (x, y) => (x % 8 === 0 || y % 8 === 0) ? [92, 92, 100] : shade([150, 150, 160], 0.9 + 0.2 * hash(x, y, 3)));
  block(3, 1, 1, (x, y) => y % 4 === 0 ? [96, 66, 40] : shade([170, 124, 78], 0.9 + 0.2 * hash(x, y, 4)));
  // 8: crate 1×1 (14×14, border and planks).
  block(8, 1, 1, (x, y) => x < 1 || y < 1 || x > 14 || y > 14 ? null : x === 1 || y === 1 || x === 14 || y === 14 ? [70, 44, 24] : y % 4 === 3 ? [120, 80, 44] : [182, 128, 70]);
  // 9: barrel 1×1 (ellipse with metal bands).
  block(9, 1, 1, (x, y) => { const dx = (x - 7.5) / 6.5, dy = (y - 7.5) / 7.5; if (dx * dx + dy * dy > 1) return null; return y === 3 || y === 12 ? [160, 160, 170] : shade([128, 76, 40], 0.8 + 0.4 * (1 - Math.abs(dx))); });
  // 10: small crate 1×1 (10×10 at the bottom centre, lighter wood).
  block(10, 1, 1, (x, y) => x < 3 || x > 12 || y < 6 ? null : x === 3 || x === 12 || y === 6 || y === 15 ? [90, 58, 30] : (x + y) % 5 === 0 ? [150, 110, 60] : [214, 170, 108]);
  // 11: bush 1×1 (green blob with dark outline) — close to grass in colour.
  block(11, 1, 1, (x, y) => { const d = Math.hypot(x - 7.5, y - 8.5); if (d > 7) return null; return d > 6 ? [30, 70, 30] : shade([70, 140, 60], 0.8 + 0.4 * hash(x, y, 7)); });
  // 12+20: torch 1×2 (thin stick, flame on top).
  block(12, 1, 2, (x, y) => { if (y >= 4 && y < 12 && Math.hypot(x - 7.5, y - 8) < 4) return y < 8 ? [255, 236, 120] : [250, 140, 40]; return y >= 12 && y < 30 && (x === 7 || x === 8) ? [90, 60, 36] : null; });
  // 13–14 (+21–22): big crate 2×2 (X brace).
  block(13, 2, 2, (x, y) => x < 1 || y < 1 || x > 30 || y > 30 ? null : x < 3 || y < 3 || x > 28 || y > 28 ? [64, 40, 22] : Math.abs(x - y) < 2 || Math.abs(x + y - 31) < 2 ? [110, 72, 40] : [168, 116, 62]);
  // 15+23: net 1×2 (lines with holes).
  block(15, 1, 2, (x, y) => x % 4 === 1 || y % 4 === 1 ? [210, 200, 170] : null);
  return { width, height, data };
}
const stamp = (id: string, width: number, height: number, tiles: number[]): Stamp => ({
  id, name: id, width, height, palette: tiles.map(tileId => ({ tilesetId: pack.id, tileId })),
  layers: [{ layerId: "art", name: "Art", cells: Uint32Array.from(tiles, (_, i) => i + 1) }],
});
export const stamps: Stamp[] = [
  stamp("crate", 1, 1, [8]), stamp("barrel", 1, 1, [9]), stamp("smallCrate", 1, 1, [10]), stamp("bush", 1, 1, [11]),
  stamp("torch", 1, 2, [12, 20]), stamp("bigCrate", 2, 2, [13, 14, 21, 22]), stamp("net", 1, 2, [15, 23]),
];

export interface Placement { stampId: string; x: number; y: number; dx?: number; dy?: number; /** 1 mirrored horizontally, 2 vertically. */ flip?: 1 | 2 }
export const SCENE = { width: 24, height: 16 };
/** Drawn in order: big crate before the small crate stacked on it. */
export const placements: Placement[] = [
  { stampId: "crate", x: 2, y: 2 }, { stampId: "crate", x: 3, y: 2 }, { stampId: "barrel", x: 6, y: 3 }, { stampId: "barrel", x: 20, y: 12 },
  { stampId: "torch", x: 8, y: 1 }, { stampId: "torch", x: 16, y: 9 }, { stampId: "bush", x: 1, y: 13 }, { stampId: "bush", x: 22, y: 1 },
  { stampId: "net", x: 18, y: 4 },
  { stampId: "bigCrate", x: 10, y: 6 }, { stampId: "smallCrate", x: 11, y: 6 },
  { stampId: "bigCrate", x: 4, y: 9 }, { stampId: "smallCrate", x: 4, y: 8, dy: 6 },
  { stampId: "crate", x: 13, y: 13 }, { stampId: "smallCrate", x: 13, y: 12, dy: 5 },
];
const groundAt = (x: number, y: number) => y >= 11 ? 1 : x >= 15 && y <= 7 ? 2 : x >= 9 && x <= 13 && y >= 9 ? 3 : 0;

/** The scene in map pixels (opaque). */
export function sceneMapPixels(extra: readonly Placement[] = []): RgbaImage {
  const art = packPixels(), width = SCENE.width * T, height = SCENE.height * T, data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const tile = groundAt(Math.floor(x / T), Math.floor(y / T)), s = (((Math.floor(tile / COLUMNS) * T + y % T) * art.width) + (tile % COLUMNS) * T + x % T) * 4;
    data.set(art.data.subarray(s, s + 4), (y * width + x) * 4);
  }
  for (const p of [...placements, ...extra]) {
    const s = stamps.find(st => st.id === p.stampId)!, { image } = stampRgba(s, [pack], () => art, T, T);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const q = ((p.flip === 2 ? image.height - 1 - y : y) * image.width + (p.flip === 1 ? image.width - 1 - x : x)) * 4, a = image.data[q + 3]! / 255;
      if (!a) continue;
      const X = p.x * T + (p.dx ?? 0) + x, Y = p.y * T + (p.dy ?? 0) + y;
      if (X < 0 || Y < 0 || X >= width || Y >= height) continue;
      const o = (Y * width + X) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = Math.round(image.data[q + c]! * a + data[o + c]! * (1 - a));
    }
  }
  return { width, height, data };
}

/** Scaled ×scale, shifted so map cell (0,0) starts at (offsetX, offsetY), right/bottom cropped, lit by a
 * horizontal gradient and a radial glow, with mild deterministic noise. */
export function hardReference(scale: number, offsetX: number, offsetY: number, crop = 9, extra: readonly Placement[] = []): RgbaImage {
  const scene = sceneMapPixels(extra), width = offsetX + scene.width * scale - crop, height = offsetY + scene.height * scale - crop, data = new Uint8Array(width * height * 4);
  const glow = { x: offsetX + 16.5 * T * scale, y: offsetY + 9.5 * T * scale, r: 3.5 * T * scale };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4, sx = Math.floor((x - offsetX) / scale), sy = Math.floor((y - offsetY) / scale);
    if (sx < 0 || sy < 0) { data.set([20, 24, 30, 255], o); continue; }
    const s = (sy * scene.width + sx) * 4, light = 0.82 + 0.3 * x / width, add = 45 * Math.max(0, 1 - Math.hypot(x - glow.x, y - glow.y) / glow.r);
    for (let c = 0; c < 3; c++) data[o + c] = Math.max(0, Math.min(255, Math.round(scene.data[s + c]! * light + add * (c === 2 ? 0.4 : 1) + (hash(x, y, 9 + c) - 0.5) * 14)));
    data[o + 3] = 255;
  }
  return { width, height, data };
}
