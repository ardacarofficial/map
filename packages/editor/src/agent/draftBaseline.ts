/** What a pending AI draft changed, for previews only: the level text at begin_edit and the last write's bounds.
 * Never persisted, never written to disk; cleared when the draft ends or the world changes. */
import type { Rect } from "@smap/agent";
import { cellFlags, cellPaletteIndex, isEntityLayer, isGridLayer, parseLevel, serializeLevel, type MapDocument, type MapStore } from "@smap/core";

const starts = new Map<string, { text: string; doc?: MapDocument }>();
const lastCall = new Map<string, Rect[]>();

/** Called when a map joins a draft (begin_edit or later enlistment); first capture wins. */
export function captureDraftStart(mapId: string, store: MapStore): void {
  if (!starts.has(mapId)) starts.set(mapId, { text: serializeLevel(store.document) });
}
export function clearDraftBaseline(): void { starts.clear(); lastCall.clear(); }
export function hasDraftStart(mapId: string): boolean { return starts.has(mapId); }
/** Baseline document parsed against the current tilesets (so tile identities compare). */
export function draftStartDocument(mapId: string, current: MapDocument): MapDocument | undefined {
  const entry = starts.get(mapId);
  if (!entry) return undefined;
  entry.doc ??= parseLevel(entry.text, current.tilesets, current.entityTypes);
  return entry.doc;
}
export function noteLastCall(affected: readonly { mapId: string; bounds?: Rect }[]): void {
  lastCall.clear();
  for (const a of affected) if (a.bounds) lastCall.set(a.mapId, [...(lastCall.get(a.mapId) ?? []), a.bounds]);
}
export function lastCallRects(mapId: string): readonly Rect[] { return lastCall.get(mapId) ?? []; }

const identity = (doc: MapDocument, cell: number, grid: boolean): string => {
  if (!cell) return "";
  if (grid) return `c${cell}`;
  const entry = doc.palette.get(cellPaletteIndex(cell));
  return entry ? `${entry.tilesetId}\u0000${entry.tileId}\u0000${cellFlags(cell)}` : `?${cell}`;
};
/** Region cells (row-major indices) whose tile/collision identity differs from the draft start. */
export function changedCells(before: MapDocument, after: MapDocument, region: Rect): Set<number> {
  const changed = new Set<number>();
  const ids = new Set([...before.layers, ...after.layers].filter(l => !isEntityLayer(l)).map(l => l.id));
  for (const id of ids) {
    const a = before.getLayer(id), b = after.getLayer(id);
    const grid = !!(a && isGridLayer(a)) || !!(b && isGridLayer(b));
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
      const index = y * region.width + x;
      if (changed.has(index)) continue;
      const mx = region.x + x, my = region.y + y;
      const va = a && mx < before.map.width && my < before.map.height ? identity(before, a.getCell(mx, my), grid) : "";
      const vb = b ? identity(after, b.getCell(mx, my), grid) : "";
      if (va !== vb) changed.add(index);
    }
  }
  return changed;
}
