/** Synthetic HARD reference pictures for matcher quality tests: a map rendered from real tiles with transparent
 * shore / waterfall / glow overlays over water, upscaled by an integer factor, shifted by a non-cell offset,
 * cropped with a dark gutter, lit by a gradient and a radial glow, plus mild noise. Deterministic (seeded). */
import type { ReferenceAlignment } from "@smap/agent";
import type { RgbaImage } from "@smap/core";
import type { TileRef, TileSource } from "../tileIndex";

export interface HardTile { ref: TileRef; rgba: Uint8Array; w: number; h: number; role: string }
export interface HardTileset { id: string; tileSize: number; tiles: HardTile[]; sheet: RgbaImage }
export interface HardCell { ground: number; overlay: number }
export interface HardMap { cols: number; rows: number; cells: HardCell[] }
export interface HardOptions {
  scale: number;
  /** Output pixel of map pixel (0,0): negative values crop partial cells at the left/top. */
  offsetX: number; offsetY: number;
  width: number; height: number;
  /** Dark editor gutter on the right/bottom edges (px). */
  gutter?: number;
  /** Lighting gradient amplitude: brightness goes from 1 − a/2 to 1 + a/2 across the picture. */
  lighting?: number;
  /** Additive radial glows (fractions of the picture size; strength 0–1). */
  glows?: { x: number; y: number; radius: number; color: [number, number, number]; strength: number }[];
  /** Uniform per-channel noise amplitude. */
  noise?: number;
  seed: number;
}
export interface HardReference { image: RgbaImage; alignment: ReferenceAlignment; /** Output pixel of map pixel (0,0). */ mapOrigin: { x: number; y: number } }

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (x: number, y: number, s: number) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

type Painter = (x: number, y: number, n: number) => [number, number, number, number];
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Procedural tileset: textured grounds (near-identical grass variants, two water variants) and transparent overlays. */
export function makeHardTileset(id: string, n: number, seed = 1): HardTileset {
  const speckle = (base: [number, number, number], dark: [number, number, number], variant: number, density: number): Painter => (x, y) => {
    const h = hash(x, y, seed * 31 + variant);
    const c = h < density ? dark : h > 1 - density * 0.5 ? base.map(v => v + 22) as [number, number, number] : base;
    return [c[0], c[1], c[2], 255];
  };
  const waves = (base: [number, number, number], variant: number): Painter => (x, y) => {
    const on = (y + variant * 3 + Math.floor(Math.sin((x + variant * 5) / n * Math.PI * 2) * n / 8)) % Math.max(4, Math.floor(n / 3)) === 0;
    const h = hash(x, y, seed * 7 + variant) * 10;
    return on ? [clamp(base[0] + 55), clamp(base[1] + 60), clamp(base[2] + 50), 255] : [clamp(base[0] + h), clamp(base[1] + h), clamp(base[2] + h), 255];
  };
  const bricks: Painter = (x, y) => {
    const row = Math.floor(y / (n / 4)), line = y % (n / 4) === 0 || (x + (row % 2) * n / 4) % (n / 2) === 0;
    const h = hash(x, y, seed + 99) * 14;
    return line ? [70, 70, 76, 255] : [clamp(126 + h), clamp(124 + h), clamp(132 + h), 255];
  };
  const cracks: Painter = (x, y) => {
    const crack = Math.abs(x - n / 2 - Math.sin(y / n * 6) * n / 5) < 1 || Math.abs(y - n * 0.7 - Math.cos(x / n * 5) * n / 8) < 1;
    const h = hash(x, y, seed + 7) * 18;
    return crack ? [50, 44, 40, 255] : [clamp(98 + h), clamp(88 + h), clamp(80 + h), 255];
  };
  const grass: [number, number, number] = [74, 140, 62], grassDark: [number, number, number] = [48, 104, 44];
  const edge = (side: "N" | "S" | "E" | "W" | "NE" | "NW" | "SE" | "SW"): Painter => (x, y) => {
    const wobble = Math.sin((side === "N" || side === "S" ? x : y) / n * Math.PI * 3 + seed) * n * 0.08;
    let d: number;
    const r = n * 0.55;
    switch (side) {
      case "N": d = n * 0.38 + wobble - y; break;
      case "S": d = y - (n * 0.62 - wobble); break;
      case "W": d = n * 0.38 + wobble - x; break;
      case "E": d = x - (n * 0.62 - wobble); break;
      case "NE": d = r - Math.hypot(n - x, y); break;
      case "NW": d = r - Math.hypot(x, y); break;
      case "SE": d = r - Math.hypot(n - x, n - y); break;
      default: d = r - Math.hypot(x, n - y);
    }
    if (d >= 0) { const p = speckle(grass, grassDark, 0, 0.18)(x, y, n); return [p[0], p[1], p[2], 255]; }
    if (d > -n * 0.12) return [235, 240, 230, 170]; // foam
    return [0, 0, 0, 0];
  };
  const waterfall: Painter = (x, y) => {
    const streak = (x * 7 + Math.floor(hash(x, 0, seed + 3) * 5)) % 5 < 2;
    return streak ? [228, 238, 255, clamp(120 + ((y * 3 + x) % 6) * 12)] : [200, 220, 245, 40];
  };
  const glow: Painter = (x, y) => {
    const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
    return d < 1 ? [170, 255, 240, clamp(150 * (1 - d))] : [0, 0, 0, 0];
  };
  const lily: Painter = (x, y) => {
    const d = Math.hypot(x + 0.5 - n * 0.45, y + 0.5 - n * 0.55);
    if (d < n * 0.18) return [230, 120, 170, 255];
    if (d < n * 0.32) return [60, 150, 60, 255];
    return [0, 0, 0, 0];
  };
  const specs: [string, Painter][] = [
    ["grass", speckle(grass, grassDark, 0, 0.18)], ["grass", speckle(grass, grassDark, 1, 0.18)], ["grass", speckle(grass, grassDark, 2, 0.18)], ["grass", speckle(grass, grassDark, 3, 0.18)],
    ["darkGrass", speckle(grassDark, [30, 76, 30], 4, 0.2)], ["sand", speckle([210, 190, 130], [176, 152, 100], 5, 0.12)], ["dirt", speckle([150, 105, 65], [112, 76, 44], 6, 0.15)],
    ["water", waves([50, 105, 180], 0)], ["water", waves([50, 105, 180], 1)], ["deep", waves([34, 72, 150], 2)], ["stone", bricks], ["rock", cracks],
    ["shoreN", edge("N")], ["shoreS", edge("S")], ["shoreE", edge("E")], ["shoreW", edge("W")],
    ["shoreNE", edge("NE")], ["shoreNW", edge("NW")], ["shoreSE", edge("SE")], ["shoreSW", edge("SW")],
    ["waterfall", waterfall], ["glow", glow], ["lily", lily],
  ];
  const columns = 8, rows = Math.ceil(specs.length / columns), sheet = { width: columns * n, height: rows * n, data: new Uint8Array(columns * n * rows * n * 4) };
  const tiles: HardTile[] = specs.map(([role, paint], tileId) => {
    const rgba = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const c = paint(x, y, n);
      rgba.set(c[3] ? c : [0, 0, 0, 0], (y * n + x) * 4);
      sheet.data.set(c[3] ? c : [0, 0, 0, 0], (((Math.floor(tileId / columns) * n + y) * sheet.width) + (tileId % columns) * n + x) * 4);
    }
    return { ref: { tilesetId: id, tileId }, rgba, w: n, h: n, role };
  });
  return { id, tileSize: n, tiles, sheet };
}

const role = (ts: readonly HardTile[], name: string) => ts.flatMap((t, i) => t.role === name ? [i] : []);

/** A lake with shores, a river with a waterfall, glowing water, lilies, a path, sand, stone and rock. */
export function makeHardMap(tiles: readonly HardTile[], cols: number, rows: number, seed = 1): HardMap {
  const pick = (name: string, x: number, y: number) => { const r = role(tiles, name); return r[Math.floor(hash(x, y, seed + name.length) * r.length)]!; };
  const cells: HardCell[] = [];
  const lake = { x: cols * 0.55, y: rows * 0.55, rx: cols * 0.22, ry: rows * 0.24 };
  const riverX = Math.floor(lake.x) - 1;
  const isWater = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
    if (((x - lake.x) / lake.rx) ** 2 + ((y - lake.y) / lake.ry) ** 2 < 1) return true;
    return (x === riverX || x === riverX + 1) && y < lake.y;
  };
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let ground: number, overlay = -1;
    if (isWater(x, y)) {
      const deep = ((x - lake.x) / lake.rx) ** 2 + ((y - lake.y) / lake.ry) ** 2 < 0.25;
      ground = deep ? pick("deep", x, y) : pick("water", x, y);
      const n = !isWater(x, y - 1) && y > 0, s = !isWater(x, y + 1) && y < rows - 1, w = !isWater(x - 1, y) && x > 0, e = !isWater(x + 1, y) && x < cols - 1;
      if (n) overlay = role(tiles, "shoreN")[0]!; else if (s) overlay = role(tiles, "shoreS")[0]!;
      else if (w) overlay = role(tiles, "shoreW")[0]!; else if (e) overlay = role(tiles, "shoreE")[0]!;
      else if (!isWater(x + 1, y - 1)) overlay = role(tiles, "shoreNE")[0]!; else if (!isWater(x - 1, y - 1)) overlay = role(tiles, "shoreNW")[0]!;
      else if (!isWater(x + 1, y + 1)) overlay = role(tiles, "shoreSE")[0]!; else if (!isWater(x - 1, y + 1)) overlay = role(tiles, "shoreSW")[0]!;
      else if ((x === riverX || x === riverX + 1) && y >= 2 && y <= 5) overlay = role(tiles, "waterfall")[0]!;
      else if (hash(x, y, seed + 5) < 0.08) overlay = role(tiles, "glow")[0]!;
      else if (hash(x, y, seed + 6) < 0.06) overlay = role(tiles, "lily")[0]!;
      if ((x === riverX || x === riverX + 1) && y >= 2 && y <= 5 && overlay < 0) overlay = role(tiles, "waterfall")[0]!;
    } else if (y === Math.floor(rows * 0.2)) ground = pick("dirt", x, y);
    else if (x < cols * 0.18 && y > rows * 0.6) ground = pick("stone", x, y);
    else if (x > cols * 0.85 && y < rows * 0.3) ground = pick("rock", x, y);
    else if (((x - lake.x) / (lake.rx + 1.6)) ** 2 + ((y - lake.y) / (lake.ry + 1.6)) ** 2 < 1 && x > lake.x) ground = pick("sand", x, y);
    else if (hash(Math.floor(x / 3), Math.floor(y / 3), seed + 11) < 0.25) ground = pick("darkGrass", x, y);
    else ground = pick("grass", x, y);
    cells.push({ ground, overlay });
  }
  return { cols, rows, cells };
}

/** Map pixels (tile size n): ground then overlay, straight-alpha "over" in sRGB like the editor renderer. */
export function renderMapPixels(tiles: readonly HardTile[], map: HardMap): RgbaImage {
  const n = tiles[0]!.w, width = map.cols * n, height = map.rows * n, data = new Uint8Array(width * height * 4);
  map.cells.forEach((cell, i) => {
    const cx = (i % map.cols) * n, cy = Math.floor(i / map.cols) * n;
    for (const t of [cell.ground, cell.overlay]) {
      if (t < 0) continue;
      const tile = tiles[t]!;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const s = (y * n + x) * 4, d = ((cy + y) * width + cx + x) * 4, sa = tile.rgba[s + 3]! / 255, da = data[d + 3]! / 255, out = sa + da * (1 - sa);
        if (!out) continue;
        for (let c = 0; c < 3; c++) data[d + c] = Math.round((tile.rgba[s + c]! * sa + data[d + c]! * da * (1 - sa)) / out);
        data[d + 3] = Math.round(out * 255);
      }
    }
  });
  return { width, height, data };
}

/** Upscale, shift/crop, gutter, lighting gradient, glows and noise. */
export function renderHardReference(mapPixels: RgbaImage, tileSize: number, o: HardOptions): HardReference {
  const { width: W, height: H, scale } = o, data = new Uint8Array(W * H * 4), rand = mulberry32(o.seed), gutter = o.gutter ?? 0;
  const lighting = o.lighting ?? 0, noise = o.noise ?? 0;
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const p = (Y * W + X) * 4;
    const mx = Math.floor((X - o.offsetX) / scale), my = Math.floor((Y - o.offsetY) / scale);
    if (X >= W - gutter || Y >= H - gutter || mx < 0 || my < 0 || mx >= mapPixels.width || my >= mapPixels.height) { data.set([27, 33, 42, 255], p); continue; }
    const q = (my * mapPixels.width + mx) * 4;
    const f = 1 - lighting / 2 + lighting * (0.6 * X / W + 0.4 * Y / H);
    const add = [0, 0, 0];
    for (const g of o.glows ?? []) {
      const d = Math.hypot(X / W - g.x, (Y / H - g.y) * H / W) / g.radius, k = g.strength * Math.exp(-d * d);
      for (let c = 0; c < 3; c++) add[c]! += g.color[c]! * k;
    }
    for (let c = 0; c < 3; c++) data[p + c] = clamp(mapPixels.data[q + c]! * f + add[c]! + (rand() * 2 - 1) * noise);
    data[p + 3] = 255;
  }
  const cellPx = tileSize * scale;
  // Truth in the detector's convention: cell 0 = first whole cell inside the picture.
  const shiftX = Math.ceil(-o.offsetX / cellPx - 1e-9), shiftY = Math.ceil(-o.offsetY / cellPx - 1e-9);
  const offsetX = o.offsetX + Math.max(0, shiftX) * cellPx, offsetY = o.offsetY + Math.max(0, shiftY) * cellPx;
  return { mapOrigin: { x: o.offsetX, y: o.offsetY }, image: { width: W, height: H, data }, alignment: { cellPx, scale, offsetX, offsetY, cols: Math.floor((W - gutter - offsetX) / cellPx), rows: Math.floor((H - gutter - offsetY) / cellPx), confidence: 1, method: "manual" } };
}

/** Index sources for a tileset (matcher input). */
export const tileSources = (tiles: readonly HardTile[]): TileSource[] => tiles.map(t => ({ ref: t.ref, rgba: t.rgba, w: t.w, h: t.h }));

/** Tiles sliced from a sheet (sample PNGs). */
export function sliceSheet(id: string, sheet: RgbaImage, n: number): HardTile[] {
  const cols = Math.floor(sheet.width / n), rows = Math.floor(sheet.height / n), out: HardTile[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const rgba = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) rgba.set(sheet.data.subarray(((r * n + y) * sheet.width + c * n) * 4, ((r * n + y) * sheet.width + c * n + n) * 4), y * n * 4);
    out.push({ ref: { tilesetId: id, tileId: r * cols + c }, rgba, w: n, h: n, role: "sample" });
  }
  return out;
}

/** Quality of a predicted grid against the truth map. Predicted cell (x, y) of alignment `used` is compared with
 * the map cell under its centre. Pixel-identical tiles count as equal. */
export function scorePrediction(tiles: readonly HardTile[], map: HardMap, reference: HardReference, used: ReferenceAlignment, cols: number, rows: number,
  predict: (x: number, y: number) => { ground: TileRef | null; overlay: TileRef | null } | null): { ground: number; overlay: number; overlayCells: number; overlayFalse: number; cells: number; misses: string[] } {
  const byRef = new Map(tiles.map((t, i) => [`${t.ref.tilesetId}:${t.ref.tileId}`, i]));
  const same = (a: TileRef | null, b: number) => {
    if (b < 0) return a === null;
    if (!a) return false;
    const i = byRef.get(`${a.tilesetId}:${a.tileId}`);
    if (i === undefined) return false;
    return i === b || tiles[i]!.rgba.every((v, k) => v === tiles[b]!.rgba[k]);
  };
  const cell = reference.alignment.cellPx, { x: ox, y: oy } = reference.mapOrigin;
  let ground = 0, overlay = 0, overlayCells = 0, overlayFalse = 0, cells = 0;
  const misses: string[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const p = predict(x, y);
    if (!p) continue;
    const mx = Math.floor((used.offsetX + (x + 0.5) * used.cellPx - ox) / cell), my = Math.floor((used.offsetY + (y + 0.5) * (used.cellPxY ?? used.cellPx) - oy) / cell);
    if (mx < 0 || my < 0 || mx >= map.cols || my >= map.rows) continue;
    const t = map.cells[my * map.cols + mx]!;
    cells++;
    const g = same(p.ground, t.ground), o = same(p.overlay, t.overlay);
    if (g) ground++;
    if (t.overlay >= 0) { overlayCells++; if (o) overlay++; } else if (p.overlay) overlayFalse++;
    if ((!g || !o) && misses.length < 40) misses.push(`${x},${y}: want ${tiles[t.ground]!.role}#${t.ground}/${t.overlay >= 0 ? tiles[t.overlay]!.role + "#" + t.overlay : "-"} got #${p.ground?.tileId}/${p.overlay ? "#" + p.overlay.tileId : "-"}`);
  }
  return { ground: cells ? ground / cells : 0, overlay: overlayCells ? overlay / overlayCells : 1, overlayCells, overlayFalse, cells, misses };
}

/** Box-filter resize by factor k (a screenshot scaled by the OS or an image viewer); the truth scales with it. */
export function resizeReference(ref: HardReference, k: number): HardReference {
  const img = ref.image, w = Math.floor(img.width * k), h = Math.floor(img.height * k), data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = x / k, x1 = (x + 1) / k, y0 = y / k, y1 = (y + 1) / k, s = [0, 0, 0, 0];
    let n = 0;
    for (let yy = Math.floor(y0); yy < Math.ceil(y1) && yy < img.height; yy++) for (let xx = Math.floor(x0); xx < Math.ceil(x1) && xx < img.width; xx++) {
      const f = (Math.min(x1, xx + 1) - Math.max(x0, xx)) * (Math.min(y1, yy + 1) - Math.max(y0, yy)), p = (yy * img.width + xx) * 4;
      for (let c = 0; c < 4; c++) s[c]! += img.data[p + c]! * f;
      n += f;
    }
    for (let c = 0; c < 4; c++) data[(y * w + x) * 4 + c] = Math.round(s[c]! / n);
  }
  const a = ref.alignment;
  return { image: { width: w, height: h, data }, mapOrigin: { x: ref.mapOrigin.x * k, y: ref.mapOrigin.y * k }, alignment: { ...a, cellPx: a.cellPx * k, scale: a.scale * k, offsetX: a.offsetX * k, offsetY: a.offsetY * k } };
}
