/** Pure solver for a single complete smart-stamp road family. */
import { FLIP_D, FLIP_H, FLIP_V } from "../cell";
import type { CellPoint, CellRect } from "../geometry";
import { assertOrientation, inverseOrientation } from "../nineSlice";
import type { PaletteEntry } from "../palette";
import { pickVariant } from "../hash";
import { flipBlobMask, reduceBlobMask } from "./topology";
import { profileIndex, type RoadProfile } from "./roadProfile";

export interface RoadTileWrite { readonly x: number; readonly y: number; readonly tile: PaletteEntry | null; readonly flags?: number }
export type RoadCellInfo = { readonly kind: "empty" } | { readonly kind: "fixed" } | { readonly kind: "blob"; readonly mask: number };
/** Recognize only this generated family, in its displayed D4 orientation. */
export function roadTileInfo(profile: RoadProfile, tilesetId: string, entry: PaletteEntry | null | undefined, flags = 0): RoadCellInfo {
  if (entry === null) return { kind: "empty" };
  if (!entry || entry.tilesetId !== tilesetId) return { kind: "fixed" };
  const tag = profile.tiles.find(t => t.tileId === entry.tileId);
  return tag ? { kind: "blob", mask: reduceBlobMask(flipBlobMask(tag.mask, !!(flags & FLIP_H), !!(flags & FLIP_V), !!(flags & FLIP_D))) } : { kind: "fixed" };
}

/** Palette-independent tile source for a blob solve, including virtual area/road preview cells. */
export interface RoadTileReader {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly read: (x: number, y: number) => { readonly tile: PaletteEntry | null | undefined; readonly flags?: number };
}

/** Full virtual paint/erase membership. Bounds are half-open; contains must be pure and independent of a preview window. */
export interface RoadMembership {
  readonly bounds: CellRect;
  readonly contains: (x: number, y: number) => boolean;
  /** Optional exact members, to avoid scanning a sparse stroke's bounding rectangle. */
  readonly cells?: readonly CellPoint[];
}

/** Immutable, deduplicated integer stroke membership. Reordering inputs has no effect. */
export function roadMembership(cells: readonly CellPoint[]): RoadMembership {
  const seen = new Map<string, CellPoint>();
  for (const p of cells) {
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) throw new TypeError("membership coordinates must be integers");
    seen.set(`${p.x},${p.y}`, Object.freeze({ x: p.x, y: p.y }));
  }
  const points = Object.freeze([...seen.values()].sort((a, b) => a.y - b.y || a.x - b.x));
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  return { bounds: points.length ? { x, y, width: right - x + 1, height: bottom - y + 1 } : { x: 0, y: 0, width: 0, height: 0 }, cells: points, contains: (cx, cy) => seen.has(`${cx},${cy}`) };
}

/** Blob preview options. Returned writes are restricted to window plus a one-cell halo; reads use complete membership. */
export interface RoadSolveOptions {
  readonly orientation?: number;
  readonly erase?: boolean;
  readonly window?: CellRect;
  /** Optional virtual membership beyond map bounds (e.g. an unclipped area). Overrides boundary only there. */
  readonly outside?: (x: number, y: number) => number;
}

/**
 * The single blob topology implementation. Reads current tiles through a pure reader and overlays full membership.
 * Only members and their one-cell neighbours can change; manual neighbours stay fixed, fitting cells retain exact flags.
 * Orientation looks up candidates in inverse mask space and emits oriented flags. A profile contains every mask; foreign neighbours stay fixed.
 */
export function solveRoadFromReader(reader: RoadTileReader, profile: RoadProfile, tilesetId: string, membership: RoadMembership, options: RoadSolveOptions = {}): RoadTileWrite[] {
  const orientation = options.orientation ?? 0;
  assertOrientation(orientation);
  const inverse = inverseOrientation(orientation), index = profileIndex(profile), { width: W, height: H } = reader;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const cache = new Map<number, RoadCellInfo>();
  const infoAt = (x: number, y: number) => {
    const i = y * W + x;
    let info = cache.get(i);
    if (!info) { const c = reader.read(x, y); info = roadTileInfo(profile, tilesetId, c.tile, c.flags ?? 0); cache.set(i, info); }
    return info;
  };
  const member = (x: number, y: number) => {
    if (membership.contains(x, y)) return options.erase ? 0 : 1;
    const c = infoAt(x, y);
    return c.kind === "blob" ? 1 : c.kind === "empty" ? 0 : -1;
  };
  const affected = new Set<number>(), b = membership.bounds, window = options.window;
  const add = (x: number, y: number) => {
    if (inside(x, y) && (!window || (x >= window.x - 1 && y >= window.y - 1 && x < window.x + window.width + 1 && y < window.y + window.height + 1))) affected.add(y * W + x);
  };
  if (membership.cells && !window) {
    for (const p of membership.cells) if (inside(p.x, p.y)) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add(p.x + dx, p.y + dy);
  } else if (b.width > 0 && b.height > 0) {
    const x0 = Math.max(0, b.x - 1, window ? window.x - 1 : 0), y0 = Math.max(0, b.y - 1, window ? window.y - 1 : 0);
    const x1 = Math.min(W, b.x + b.width + 1, window ? window.x + window.width + 1 : W), y1 = Math.min(H, b.y + b.height + 1, window ? window.y + window.height + 1 : H);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      let touched = false;
      for (let dy = -1; dy <= 1 && !touched; dy++) for (let dx = -1; dx <= 1; dx++) if (inside(x + dx, y + dy) && membership.contains(x + dx, y + dy)) { touched = true; break; }
      if (touched) add(x, y);
    }
  }
  const offsets = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const;
  const writes: RoadTileWrite[] = [];
  for (const i of [...affected].sort((a, b) => a - b)) {
    const x = i % W, y = Math.floor(i / W), info = infoAt(x, y), m = member(x, y);
    if (!membership.contains(x, y) && info.kind !== "blob") continue;
    if (m <= 0) { if (info.kind !== "empty") writes.push({ x, y, tile: null }); continue; }
    let raw = 0;
    offsets.forEach(([dx, dy], bit) => {
      const nx = x + dx, ny = y + dy;
      if (inside(nx, ny) ? member(nx, ny) === m : options.outside ? options.outside(nx, ny) === m : false) raw |= 1 << bit;
    });
    const mask = reduceBlobMask(raw);
    if (info.kind === "blob" && info.mask === mask) continue;
    const lookup = flipBlobMask(mask, !!(inverse & FLIP_H), !!(inverse & FLIP_V), !!(inverse & FLIP_D));
    const byMask = index;
    if (!byMask || byMask.size === 0) continue;
    const ids = byMask.get(lookup)!;
    writes.push({ x, y, tile: { tilesetId: tilesetId, tileId: ids![pickVariant(ids!.length, reader.seed, x, y)]! }, ...(orientation ? { flags: orientation } : {}) });
  }
  return writes;
}
