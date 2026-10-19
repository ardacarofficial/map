import { bandWidth, type BandedSource } from "./bands";
/** Persistent mask → generated slot mapping. Source/cap variants retain the layout-1 ABI. */
import type { TileClip } from "../clip";
import { nineSliceLayout, nineSliceProblem } from "../nineSlice";
import { BLOB47_MASKS, reduceBlobMask } from "./topology";

export interface RoadProfile { readonly tiles: readonly { readonly tileId: number; readonly mask: number }[] }

export function roadProfileProblem(value: unknown): string | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as RoadProfile).tiles)) return "road profile requires tiles";
  const ids = new Set<number>(), masks = new Set<number>();
  for (const t of (value as RoadProfile).tiles) {
    if (!t || !Number.isSafeInteger(t.tileId) || t.tileId < 0 || ids.has(t.tileId) || !BLOB47_MASKS.includes(t.mask)) return "road profile requires unique tile ids and reduced masks";
    ids.add(t.tileId); masks.add(t.mask);
  }
  return BLOB47_MASKS.every(m => masks.has(m)) ? null : "road profile requires all 47 masks";
}
export function normalizeRoadProfile(profile: RoadProfile): RoadProfile {
  const problem = roadProfileProblem(profile); if (problem) throw new Error(problem);
  return Object.freeze({ tiles: Object.freeze([...profile.tiles].sort((a, b) => a.tileId - b.tileId).map(t => Object.freeze({ tileId: t.tileId, mask: t.mask }))) });
}
const cache = new WeakMap<RoadProfile, ReadonlyMap<number, readonly number[]>>();
export function profileIndex(profile: RoadProfile): ReadonlyMap<number, readonly number[]> {
  const existing = cache.get(profile); if (existing) return existing;
  const normalized = normalizeRoadProfile(profile), index = new Map<number, number[]>();
  for (const t of normalized.tiles) { const ids = index.get(t.mask) ?? []; ids.push(t.tileId); index.set(t.mask, ids); }
  cache.set(profile, index); return index;
}

/** Full source copies, compact caps and the 47-mask bank, in their original v3 slot order. */
export function buildRoadProfile(source: TileClip & BandedSource, layerId: string): RoadProfile {
  const problem = nineSliceProblem(source, { roadLayerId: layerId }); if (problem) throw new Error(problem);
  const b=bandWidth(source);
  if(b>1) {const l=nineSliceLayout(source);return normalizeRoadProfile({tiles:BLOB47_MASKS.flatMap((mask,rank)=>Array.from({length:b*b},(_,i)=>({tileId:l.bank+rank*b*b+i,mask})))});}
  return buildLayout1RoadProfile(source.width, source.height);
}
/** Reconstruct layout-1 provenance without loading a PNG or inspecting map cells. */
export function buildLayout1RoadProfile(n: number, m: number): RoadProfile {
  const l = nineSliceLayout({ width: n, height: m }), tiles: { tileId: number; mask: number }[] = [];
  const tag = (tileId: number, x: number, y: number, w: number, h: number) => {
    let mask = 0;
    [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]].forEach(([dx,dy], bit) => { if (x + dx! >= 0 && y + dy! >= 0 && x + dx! < w && y + dy! < h) mask |= 1 << bit; });
    tiles.push({ tileId, mask: reduceBlobMask(mask) });
  };
  for (let y = 0; y < m; y++) for (let x = 0; x < n; x++) tag(y * n + x, x, y, n, m);
  for (let y = 0; y < m; y++) tag(l.collapsedWidth + y, 0, y, 1, m);
  for (let x = 0; x < n; x++) tag(l.collapsedHeight + x, x, 0, n, 1);
  tag(l.isolated, 0, 0, 1, 1);
  BLOB47_MASKS.forEach((mask, rank) => tiles.push({ tileId: l.bank + rank, mask }));
  return normalizeRoadProfile({ tiles });
}
