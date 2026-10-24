/** Pure, bounded discovery of smart (edge/centre) source rectangles in one tileset sheet. */
import { detectNineSliceSelection, NINE_SLICE_DETECTION_THRESHOLDS, type NineSliceSelectionInput } from "./detect";

export interface SmartCandidate {
  /** Tileset grid cells, the same rectangle prepare_smart_source / the Tileset panel selection uses. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Edge band thickness b in tiles. */
  readonly band: number;
  /** "road" sources also draw connected roads/rivers; "area" sources only fill rectangles. */
  readonly kind: "road" | "area";
}
export interface SmartCandidateOptions {
  /** Largest scanned rectangle side in tiles (default 12, never above the sheet). */
  readonly maxSide?: number;
  /** Detector evaluations allowed (default 512). Discovery stops early and deterministically when exhausted. */
  readonly maxDetections?: number;
}
type SheetInput = Pick<NineSliceSelectionInput, "tileset" | "emptyIds"> & { readonly pixels: NonNullable<NineSliceSelectionInput["pixels"]> };

/**
 * Finds maximal detector-v6 rectangles, largest first, never overlapping. A cheap pass first rejects windows with
 * transparent/empty tiles, discontinuous internal joins or a corner identical to its centre (borderless texture),
 * so the full detector only runs on plausible windows. Same pixels always give the same ordered result.
 */
export function findSmartCandidates(input: SheetInput, options: SmartCandidateOptions = {}): SmartCandidate[] {
  const { tileset: t, pixels: p } = input, C = t.columns, R = t.rows, tw = t.tileWidth, th = t.tileHeight;
  const ox = p.originX ?? 0, oy = p.originY ?? 0, seam = NINE_SLICE_DETECTION_THRESHOLDS;
  if (![C, R, tw, th].every(v => Number.isSafeInteger(v) && v > 0) || C < 3 || R < 3) return [];
  const maxSide = Math.min(options.maxSide ?? 12, Math.max(C, R));
  let detections = options.maxDetections ?? 512;
  const base = (col: number, row: number) => [t.margin + col * (tw + t.spacing) - ox, t.margin + row * (th + t.spacing) - oy] as const;
  const fits = (col: number, row: number) => { const [x, y] = base(col, row); return x >= 0 && y >= 0 && x + tw <= p.width && y + th <= p.height; };
  const at = (col: number, row: number, px: number, py: number) => {
    const [x, y] = base(col, row), i = ((y + py) * p.width + x + px) * 4, a = p.data[i + 3]!;
    return [p.data[i]! * a / 255, p.data[i + 1]! * a / 255, p.data[i + 2]! * a / 255, a] as const;
  };
  const N = C * R, bad = new Uint8Array(N), hash = new Float64Array(N);
  for (let row = 0; row < R; row++) for (let col = 0; col < C; col++) {
    const id = row * C + col;
    if (input.emptyIds.has(id) || !fits(col, row)) { bad[id] = 1; continue; }
    let opaque = false, h = 0;
    for (let py = 0; py < th; py++) for (let px = 0; px < tw; px++) {
      const v = at(col, row, px, py);
      if (v[3]) opaque = true;
      h = (h * 31 + v[0] * 3 + v[1] * 5 + v[2] * 7 + v[3]) % 1_000_000_007;
    }
    bad[id] = opaque ? 0 : 1; hash[id] = h;
  }
  // Join continuity uses the detector's own seam thresholds on the shared edge.
  const join = (col: number, row: number, dx: number, dy: number) => {
    const count = dx ? th : tw;
    let good = 0;
    for (let i = 0; i < count; i++) {
      const a = at(col, row, dx ? tw - 1 : i, dy ? th - 1 : i), b = at(col + dx, row + dy, dx ? 0 : i, dy ? 0 : i);
      if (a.every((v, c) => Math.abs(v - b[c]!) <= seam.seamDelta)) good++;
    }
    return good / count >= seam.seamFraction;
  };
  // 2D prefix sums of rejection markers make every window test O(1).
  const prefix = (marker: (col: number, row: number) => boolean) => {
    const s = new Int32Array((C + 1) * (R + 1));
    for (let row = 0; row < R; row++) for (let col = 0; col < C; col++)
      s[(row + 1) * (C + 1) + col + 1] = (marker(col, row) ? 1 : 0) + s[row * (C + 1) + col + 1]! + s[(row + 1) * (C + 1) + col]! - s[row * (C + 1) + col]!;
    return (col: number, row: number, w: number, h: number) => w <= 0 || h <= 0 ? 0 : s[(row + h) * (C + 1) + col + w]! - s[row * (C + 1) + col + w]! - s[(row + h) * (C + 1) + col]! + s[row * (C + 1) + col]!;
  };
  const badTiles = prefix((col, row) => bad[row * C + col] === 1);
  const badRight = prefix((col, row) => col < C - 1 && (bad[row * C + col] === 1 || bad[row * C + col + 1] === 1 || !join(col, row, 1, 0)));
  const badDown = prefix((col, row) => row < R - 1 && (bad[row * C + col] === 1 || bad[(row + 1) * C + col] === 1 || !join(col, row, 0, 1)));
  const taken = new Uint8Array(N), out: SmartCandidate[] = [];
  const free = (col: number, row: number, w: number, h: number) => {
    for (let y = row; y < row + h; y++) for (let x = col; x < col + w; x++) if (taken[y * C + x]) return false;
    return true;
  };
  const sizes: [number, number][] = [];
  for (let h = 3; h <= Math.min(maxSide, R); h++) for (let w = 3; w <= Math.min(maxSide, C); w++) sizes.push([w, h]);
  sizes.sort((a, b) => b[0] * b[1] - a[0] * a[1] || b[1] - a[1] || b[0] - a[0]);
  for (const [w, h] of sizes) for (let row = 0; row + h <= R; row++) for (let col = 0; col + w <= C; col++) {
    if (detections <= 0) return out;
    if (badTiles(col, row, w, h) || badRight(col, row, w - 1, h) || badDown(col, row, w, h - 1)) continue;
    // A border needs a corner unlike the centre; identical tiles mean a borderless texture.
    if (hash[row * C + col] === hash[(row + 1) * C + col + 1] && hash[(row + h - 1) * C + col + w - 1] === hash[(row + h - 2) * C + col + w - 2]) continue;
    if (!free(col, row, w, h)) continue;
    detections--;
    const ids = Array.from({ length: w * h }, (_, i) => (row + Math.floor(i / w)) * C + col + i % w);
    const found = detectNineSliceSelection({ tileset: t, rect: { col, row, width: w, height: h }, ids, emptyIds: input.emptyIds, pixels: p });
    if (!found) continue;
    for (let y = row; y < row + h; y++) for (let x = col; x < col + w; x++) taken[y * C + x] = 1;
    // Detection requires every tile opaque, so every found source has the full road representatives.
    out.push(Object.freeze({ rect: Object.freeze({ x: col, y: row, width: w, height: h }), band: found.border, kind: "road" as const }));
  }
  return out;
}
