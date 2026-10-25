/** Stamp candidates from a tileset sheet (K6). Pure and read-only: a multi-tile object is a group of non-empty
 * tiles whose art touches across tile edges. Groups made only of fully opaque tiles are terrain, not objects. */
import { OBJECT_LIMITS, type Rect, type StampCandidate } from "@smap/agent";
import { cellFlags, cellPaletteIndex, isValidTileId, tileRect, type RgbaImage, type Stamp, type Tileset } from "@smap/core";

export interface SuggestInput { tileset: Tileset; pixels: RgbaImage; region: Rect; minTiles: number; stamps?: readonly Stamp[] }
export interface SuggestOutput { candidates: StampCandidate[]; truncated: boolean; skipped: { tooLarge: number; opaque: number } }

const VISIBLE_ALPHA = 16;

export function suggestStampCandidates({ tileset, pixels, region, minTiles, stamps = [] }: SuggestInput): SuggestOutput {
  const { tileWidth: tw, tileHeight: th } = tileset;
  const cols = region.width, rows = region.height, n = cols * rows;
  const alphaAt = (tile: number, x: number, y: number) => {
    const r = tileRect(tileset, tile);
    return pixels.data[((r.y + y) * pixels.width + r.x + x) * 4 + 3]!;
  };
  const tileAt = (i: number) => (region.y + Math.floor(i / cols)) * tileset.columns + region.x + i % cols;
  // Per tile: has art, fully opaque.
  const visible = new Uint8Array(n), opaque = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const tile = tileAt(i);
    if (!isValidTileId(tileset, tile)) continue;
    const r = tileRect(tileset, tile);
    if (r.x + r.width > pixels.width || r.y + r.height > pixels.height) continue;
    let seen = 0, solid = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const a = alphaAt(tile, x, y); if (a > VISIBLE_ALPHA) seen++; if (a >= 250) solid++; }
    visible[i] = seen ? 1 : 0; opaque[i] = solid === tw * th ? 1 : 0;
  }
  // Union of neighbouring tiles whose edge pixels touch (8-neighbourhood across the edge).
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  const join = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  for (let i = 0; i < n; i++) {
    if (!visible[i]) continue;
    const col = i % cols, row = Math.floor(i / cols), a = tileAt(i);
    if (col + 1 < cols && visible[i + 1]) {
      const b = tileAt(i + 1);
      touch: for (let y = 0; y < th; y++) if (alphaAt(a, tw - 1, y) > VISIBLE_ALPHA)
        for (let d = -1; d <= 1; d++) if (y + d >= 0 && y + d < th && alphaAt(b, 0, y + d) > VISIBLE_ALPHA) { join(i, i + 1); break touch; }
    }
    if (row + 1 < rows && visible[i + cols]) {
      const b = tileAt(i + cols);
      touch: for (let x = 0; x < tw; x++) if (alphaAt(a, x, th - 1) > VISIBLE_ALPHA)
        for (let d = -1; d <= 1; d++) if (x + d >= 0 && x + d < tw && alphaAt(b, x + d, 0) > VISIBLE_ALPHA) { join(i, i + cols); break touch; }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) if (visible[i]) { const r = find(i), list = groups.get(r); if (list) list.push(i); else groups.set(r, [i]); }
  const skipped = { tooLarge: 0, opaque: 0 };
  const found: { region: Rect; tiles: number[] }[] = [];
  for (const members of groups.values()) {
    if (members.length < minTiles) continue;
    const xs = members.map(i => i % cols), ys = members.map(i => Math.floor(i / cols));
    const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 };
    if (members.every(i => opaque[i])) { skipped.opaque++; continue; }
    if (box.width > OBJECT_LIMITS.candidateSide || box.height > OBJECT_LIMITS.candidateSide || members.length > OBJECT_LIMITS.candidateTiles) { skipped.tooLarge++; continue; }
    found.push({ region: { x: region.x + box.x, y: region.y + box.y, width: box.width, height: box.height }, tiles: members });
  }
  found.sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x);
  const truncated = found.length > OBJECT_LIMITS.candidates;
  const candidates = found.slice(0, OBJECT_LIMITS.candidates).map((c, k): StampCandidate => {
    const inside = new Set(c.tiles);
    const tileIds: number[] = [];
    let other = 0;
    for (let y = c.region.y; y < c.region.y + c.region.height; y++) for (let x = c.region.x; x < c.region.x + c.region.width; x++) {
      const i = (y - region.y) * cols + x - region.x;
      if (inside.has(i)) tileIds.push(y * tileset.columns + x); else if (visible[i]) other++;
    }
    const existing = stamps.find(s => sameTiles(s, tileset, c.region, i => !!visible[(Math.floor(i / c.region.width) + c.region.y - region.y) * cols + i % c.region.width + c.region.x - region.x]));
    return { n: k + 1, region: c.region, tileIds, ...(other ? { otherTiles: other } : {}), ...(existing ? { existingStampId: existing.id } : {}) };
  });
  return { candidates, truncated, skipped };
}

/** The stamp shows exactly the region's tiles (transparent tiles may be left empty), unflipped. */
function sameTiles(stamp: Stamp, tileset: Tileset, region: Rect, hasArt: (i: number) => boolean): boolean {
  if (stamp.width !== region.width || stamp.height !== region.height) return false;
  const top = new Array<number | null>(stamp.width * stamp.height).fill(null);
  for (const layer of stamp.layers) {
    if (layer.grid) continue;
    for (let i = 0; i < layer.cells.length; i++) {
      const value = layer.cells[i]!, entry = stamp.palette[cellPaletteIndex(value) - 1];
      if (!entry) continue;
      if (entry.tilesetId !== tileset.id || cellFlags(value)) return false;
      top[i] = entry.tileId;
    }
  }
  return top.every((tile, i) => {
    const expected = (region.y + Math.floor(i / region.width)) * tileset.columns + region.x + i % region.width;
    return tile === expected || (tile === null && !hasArt(i));
  });
}
