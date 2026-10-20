import { t } from "../i18n";
/** Pixel planning/COW boundary. No DOM, UI state, disk IO or live mutation until commit. */
import {
  cellPaletteIndex, cellFlags, isTileLayer, MapStore, parseLevel, serializeLevel,
  pixelStrokePoints, pixelRectangle, mirrorPixels, pixelDirtyRect, planPixelFill, placedPixelSize,
  placedToSourcePixel, sourceToPlacedPixel, rasterContentHash, prepareWorldEdit, applyWorldEdit, WorldEditError,
  type RasterImage, type Rgba8, type PixelPoint, type PixelRect, type PixelWrite, type TilePixelPlan,
  type PixelRectPatch, type WorldEditOperation, type WorldEditInput, type MapDocument, type Tileset, type TileClip,
} from '@smap/core';
import type { LevelWorkspace } from '../io/levelWorkspace';

export type PixelTool = 'brush' | 'eraser' | 'fill' | 'eyedropper' | 'line' | 'rect';
export type PixelScope = 'cell' | 'world';
export interface PixelGestureOptions {
  tool: PixelTool; color: Rgba8; size: number; shape: 'square' | 'circle'; scope: PixelScope;
  fillMode: 'contiguous' | 'global'; filled: boolean; mirrorH: boolean; mirrorV: boolean; mirrorOrigin?: PixelPoint;
}
export type PixelSource = (tileset: Tileset, tileId: number) => RasterImage | undefined;
export interface PixelOwner {
  cellX: number; cellY: number; flags: number; tilesetId?: string; tileId?: number;
  width: number; height: number; data: Uint8Array; x: number; y: number;
  original?: RasterImage;
  previewRect?: PixelRect;
  previewAsset?: { assetId: string; tileId: number };
}
export function rasterView(image: Pick<RasterImage, 'width' | 'height' | 'data'>) {
  return { width: image.width, height: image.height, get(x: number, y: number): Rgba8 {
    const p = (y * image.width + x) * 4;
    return { r: image.data[p]!, g: image.data[p + 1]!, b: image.data[p + 2]!, a: image.data[p + 3]! };
  } };
}
/** Normalize only undersized art: transparent padding, bottom-left anchor, flags preserved. */
export function pixelOwner(store: MapStore, layerId: string, cellX: number, cellY: number, source: PixelSource): PixelOwner | null {
  const doc = store.document, layer = doc.getLayer(layerId), map = doc.map;
  if (!isTileLayer(layer) || !doc.inBounds(cellX, cellY)) return null;
  const cell = layer.getCell(cellX, cellY), flags = cellFlags(cell), entry = doc.palette.get(cellPaletteIndex(cell));
  const ts = entry ? doc.getTileset(entry.tilesetId) : undefined;
  const original = ts && entry ? store.rasterAssets.getTile(ts.id, entry.tileId) ?? source(ts, entry.tileId) : undefined;
  if (cell && !original) throw new Error('pixel source unavailable');
  const extent = original ? placedPixelSize(original.width, original.height, flags) : { width: map.tileWidth, height: map.tileHeight };
  const pw = Math.max(map.tileWidth, extent.width), ph = Math.max(map.tileHeight, extent.height);
  const swapped = placedPixelSize(pw, ph, flags);
  const width = swapped.width, height = swapped.height;
  let data: Uint8Array;
  if (original && width === original.width && height === original.height) data = original.data.slice();
  else {
    data = new Uint8Array(width * height * 4);
    if (original) for (let y = 0; y < original.height; y++) for (let x = 0; x < original.width; x++) {
      const p = sourceToPlacedPixel({ x, y }, original.width, original.height, flags);
      const q = placedToSourcePixel({ x: p.x, y: p.y + ph - extent.height }, width, height, flags);
      data.set(original.data.subarray((y * original.width + x) * 4, (y * original.width + x) * 4 + 4), (q.y * width + q.x) * 4);
    }
  }
  return { cellX, cellY, flags, ...(entry ? { tilesetId: entry.tilesetId, tileId: entry.tileId } : {}), width, height, data, x: cellX * map.tileWidth, y: (cellY + 1) * map.tileHeight - ph, ...(original ? { original } : {}) };
}
export interface PixelCellPlan extends TilePixelPlan { readonly owner: PixelOwner }
export function planPixelGesture(store: MapStore, layerId: string, samples: readonly PixelPoint[], options: PixelGestureOptions, source: PixelSource): PixelCellPlan[] {
  if (!samples.length) return [];
  const map = store.document.map, start = samples[0]!;
  const owners = new Map<string, PixelOwner | null>();
  const ownerAt = (x: number, y: number) => { const key = `${x},${y}`; if (!owners.has(key)) owners.set(key, pixelOwner(store, layerId, x, y, source)); return owners.get(key)!; };
  const initial = ownerAt(Math.floor(start.x / map.tileWidth), Math.floor(start.y / map.tileHeight));
  if (!initial) return [];
  const sameIdentity = (owner: PixelOwner) => options.scope !== "world" || !initial.tilesetId || (owner.tilesetId === initial.tilesetId && owner.tileId === initial.tileId);
  const color = options.tool === 'eraser' ? { r: 0, g: 0, b: 0, a: 0 } : options.color;
  if (options.tool === 'fill') {
    const seeds = options.mirrorH || options.mirrorV ? mirrorPixels([start], { horizontal: options.mirrorH, vertical: options.mirrorV, origin: options.mirrorOrigin ?? { x: (map.width * map.tileWidth - 1) / 2, y: (map.height * map.tileHeight - 1) / 2 } }) : [start];
    const drafts = new Map<PixelOwner, Map<number, PixelWrite>>();
    for (const seed of seeds) {
      const o = ownerAt(Math.floor(seed.x / map.tileWidth), Math.floor(seed.y / map.tileHeight));
      if (!o || !sameIdentity(o)) continue;
      const local = placedToSourcePixel({ x: seed.x - o.x, y: seed.y - o.y }, o.width, o.height, o.flags);
      const plan = planPixelFill(rasterView(o), local, color, options.fillMode);
      let writes = drafts.get(o); if (!writes) { writes = new Map(); drafts.set(o, writes); }
      for (const w of plan.writes) writes.set(w.y * o.width + w.x, w);
    }
    return [...drafts].filter(([, writes]) => writes.size).map(([owner, writes]) => { const all = [...writes.values()]; return { cellX: owner.cellX, cellY: owner.cellY, owner, writes: all, dirtyRect: pixelDirtyRect(all) }; }).sort((a, b) => a.cellY - b.cellY || a.cellX - b.cellX);
  }
  const end = samples.at(-1)!;
  let points = options.tool === 'rect' ? pixelRectangle(start, end, options.filled) : pixelStrokePoints(options.tool === 'line' ? [start, end] : samples, options.size, options.shape);
  if (options.mirrorH || options.mirrorV) points = mirrorPixels(points, { horizontal: options.mirrorH, vertical: options.mirrorV, origin: options.mirrorOrigin ?? { x: (map.width * map.tileWidth - 1) / 2, y: (map.height * map.tileHeight - 1) / 2 } });
  const drafts = new Map<PixelOwner, Map<number, PixelWrite>>();
  const extent = placedPixelSize(initial.width, initial.height, initial.flags);
  const oversized = extent.width > map.tileWidth || extent.height > map.tileHeight;
  for (const p of points) {
    const o = oversized ? initial : ownerAt(Math.floor(p.x / map.tileWidth), Math.floor(p.y / map.tileHeight));
    if (!o || !sameIdentity(o)) continue;
    const q = placedToSourcePixel({ x: p.x - o.x, y: p.y - o.y }, o.width, o.height, o.flags);
    if (q.x < 0 || q.y < 0 || q.x >= o.width || q.y >= o.height || (o.data[(q.y * o.width + q.x) * 4] === color.r && o.data[(q.y * o.width + q.x) * 4 + 1] === color.g && o.data[(q.y * o.width + q.x) * 4 + 2] === color.b && o.data[(q.y * o.width + q.x) * 4 + 3] === color.a)) continue;
    let writes = drafts.get(o); if (!writes) { writes = new Map(); drafts.set(o, writes); }
    writes.set(q.y * o.width + q.x, { ...q, color });
  }
  return [...drafts].map(([owner, map]) => { const writes = [...map.values()].sort((a, b) => a.y - b.y || a.x - b.x); return { cellX: owner.cellX, cellY: owner.cellY, owner, writes, dirtyRect: pixelDirtyRect(writes) }; }).sort((a, b) => a.cellY - b.cellY || a.cellX - b.cellX);
}
export function applyPixelWrites(owner: PixelOwner, writes: readonly PixelWrite[]): Uint8Array {
  const after = owner.data.slice();
  for (const w of writes) after.set([w.color.r, w.color.g, w.color.b, w.color.a], (w.y * owner.width + w.x) * 4);
  return after;
}
function detached(store: MapStore): MapStore {
  const doc = store.document;
  return new MapStore(parseLevel(serializeLevel(doc), doc.tilesets, doc.entityTypes), { rasterAssets: store.rasterAssets.fork() });
}
export function tileUsages(doc: MapDocument, tilesetId: string, tileId: number) {
  const indices = new Set<number>();
  for (let i = 1; i <= doc.palette.size; i++) { const e = doc.palette.get(i); if (e?.tilesetId === tilesetId && e.tileId === tileId) indices.add(i); }
  const usages: { layerId: string; x: number; y: number }[] = [];
  if (!indices.size) return usages;
  for (const layer of doc.layers) if (isTileLayer(layer)) for (const chunk of layer.chunks()) for (let i = 0; i < chunk.data.length; i++) {
    if (indices.has(cellPaletteIndex(chunk.data[i]!))) usages.push({ layerId: layer.id, x: (chunk.cx << 5) + (i & 31), y: (chunk.cy << 5) + (i >> 5) });
  }
  const order = new Map(doc.layers.map((l, i) => [l.id, i]));
  return usages.sort((a, b) => order.get(a.layerId)! - order.get(b.layerId)! || a.y - b.y || a.x - b.x);
}
/** Map scope leaves palette/stamp references to their previous raster snapshot. */
export function hasPixelLibraryReference(doc: MapDocument, tilesetId: string, tileId: number, clips: readonly TileClip[] = []): boolean {
  const matches = (e: { tilesetId: string; tileId: number }) => e.tilesetId === tilesetId && e.tileId === tileId;
  return doc.collections.some(c => c.cells.some(matches)) || doc.randomSets.some(s => s.candidates.some(c => c.kind === 'tile' && matches(c))) || clips.some(c => c.palette.some(matches));
}
/** Translate normalized source coordinates through the original native tile, including padding. */
function mapOwnerWrite(w: PixelWrite, from: PixelOwner, to: PixelOwner): PixelWrite {
  if (!from.original) return w;
  const original = from.original;
  const placed = sourceToPlacedPixel(w, from.width, from.height, from.flags);
  const fromNative = placedPixelSize(original.width, original.height, from.flags), fromExtent = placedPixelSize(from.width, from.height, from.flags);
  const canonical = placedToSourcePixel({ x: placed.x, y: placed.y - fromExtent.height + fromNative.height }, original.width, original.height, from.flags);
  const targetPlaced = sourceToPlacedPixel(canonical, original.width, original.height, to.flags);
  const toNative = placedPixelSize(original.width, original.height, to.flags), toExtent = placedPixelSize(to.width, to.height, to.flags);
  return { ...placedToSourcePixel({ x: targetPlaced.x, y: targetPlaced.y + toExtent.height - toNative.height }, to.width, to.height, to.flags), color: w.color };
}
/** World maps must already be loaded/pinned. Returns a version-guarded synchronous commit. */
export function preparePixelCommit(ws: LevelWorkspace, layerId: string, plans: readonly PixelCellPlan[], scope: PixelScope, source: PixelSource, clips: readonly TileClip[] = []): () => void {
  if (!plans.length) return () => {};
  const origin = ws.activeId, live = ws.active.store;
  const maps = [...ws.levels].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (maps.some(m => !ws.entry(m.id))) throw new WorldEditError(maps.filter(m => !ws.entry(m.id)).map(m => ({ mapId: m.id, reason: 'load' })));
  let scratch: MapStore | undefined;
  const reusedPatches: PixelRectPatch[] = [];
  const inputs: WorldEditInput[] = [{ mapId: origin, store: live, operations: [] }];
  const ops = new Map<string, WorldEditOperation[]>();
  for (const m of maps) { const list: WorldEditOperation[] = []; ops.set(m.id, list); if (m.id === origin) inputs[0] = { mapId: origin, store: live, operations: list }; else inputs.push({ mapId: m.id, store: ws.entry(m.id)!.store, operations: list }); }
  const originOps = ops.get(origin)!;
  const processed = new Set<string>();
  const merged = scope === 'world' ? [...plans.reduce((byTile, plan) => {
    const key = plan.owner.tilesetId ? `${plan.owner.tilesetId}:${plan.owner.tileId}` : `empty:${plan.cellX},${plan.cellY}`;
    const prev = byTile.get(key);
    if (!prev) byTile.set(key, plan);
    else { const writes = new Map(prev.writes.map(w => [`${w.x},${w.y}`, w])); for (const sourceWrite of plan.writes) { const w = mapOwnerWrite(sourceWrite, plan.owner, prev.owner); writes.set(`${w.x},${w.y}`, w); } const all = [...writes.values()]; byTile.set(key, { ...prev, writes: all, dirtyRect: pixelDirtyRect(all) }); }
    return byTile;
  }, new Map<string, PixelCellPlan>()).values()] : plans;
  for (const plan of merged) {
    const o = plan.owner, key = `${o.tilesetId}:${o.tileId}`;
    if (scope === 'world' && o.tilesetId && processed.has(key)) continue;
    processed.add(key);
    const usageCount = o.tilesetId ? maps.reduce((n, m) => n + ws.entry(m.id)!.store.tileUsageCount(o.tilesetId!, o.tileId!), 0) : 0;
    const all = scope === 'world' && o.tilesetId ? maps.flatMap(m => tileUsages(ws.entry(m.id)!.store.document, o.tilesetId!, o.tileId!).map(u => ({ ...u, mapId: m.id }))) : [];
    const targets = scope === 'world' && o.tilesetId ? all : [{ mapId: origin, layerId, x: o.cellX, y: o.cellY }];
    const blockers = targets.flatMap(t => { const l = ws.entry(t.mapId)!.store.document.getLayer(t.layerId)!; return [...(l.locked ? [{ mapId: t.mapId, layerId: t.layerId, reason: 'locked' as const }] : []), ...(!l.visible ? [{ mapId: t.mapId, layerId: t.layerId, reason: 'hidden' as const }] : [])]; });
    if (blockers.length) throw new WorldEditError(blockers);
    // Group canonical destination rasters by native dimensions. Each placement retains its flags.
    const groups = new Map<string, { owner: PixelOwner; writes: readonly PixelWrite[]; targets: typeof targets }>();
    for (const t of targets) {
      const owner = pixelOwner(ws.entry(t.mapId)!.store, t.layerId, t.x, t.y, source)!;
      const padding = owner.original && (owner.width !== owner.original.width || owner.height !== owner.original.height);
      const groupKey = `${owner.width}x${owner.height}:${padding ? owner.flags : 0}`;
      let group = groups.get(groupKey);
      if (!group) {
        // Expanded tiles have source-space padding depending on flips; preserve the source pixel coordinates.
        const writes = plan.writes.map(w => mapOwnerWrite(w, o, owner)).filter(w => w.x >= 0 && w.y >= 0 && w.x < owner.width && w.y < owner.height);
        group = { owner, writes, targets: [] }; groups.set(groupKey, group);
      }
      group.targets.push(t);
    }
    for (const group of groups.values()) {
      if (!group.writes.length) continue;
      const owner = group.owner, after = applyPixelWrites(owner, group.writes);
      let assetId = o.tilesetId!, tileId = o.tileId!;
      const ts = o.tilesetId ? live.document.getTileset(o.tilesetId) : undefined;
      const reuse = ts?.edited && tileId < ts.edited.nextTileId && usageCount === 1 && !hasPixelLibraryReference(live.document, ts.id, tileId, clips) && owner.width === ts.tileWidth && owner.height === ts.tileHeight;
      if (reuse) {
        const rect = pixelDirtyRect(group.writes)!;
        const crop = (data: Uint8Array) => { const out = new Uint8Array(rect.width * rect.height * 4); for (let row = 0; row < rect.height; row++) { const offset = ((rect.y + row) * owner.width + rect.x) * 4; out.set(data.subarray(offset, offset + rect.width * 4), row * rect.width * 4); } return out; };
        reusedPatches.push({ assetId, tileId, ...rect, before: crop(owner.data), after: crop(after) });
        continue;
      } else {
        const op = { type: 'allocateEditedTile', tileWidth: owner.width, tileHeight: owner.height, pixels: after, ...(o.tilesetId && o.original ? { source: { tilesetId: o.tilesetId, tileId: o.tileId!, pixelHash: rasterContentHash(o.original.width, o.original.height, o.original.data) } } : {}) } as const;
        scratch ??= detached(live);
        const slot = scratch.dispatch(op); assetId = slot.assetId; tileId = slot.tileId; originOps.push(op);
      }
      for (const t of group.targets) ops.get(t.mapId)!.push({ type: 'remapCells', layerId: t.layerId, cells: [{ x: t.x, y: t.y }], tilesetId: assetId, tileId });
    }
  }
  if (reusedPatches.length) originOps.push({ type: "patchPixels", patches: reusedPatches });
  const prepared = prepareWorldEdit(origin, inputs, t('pixel.stroke'));
  return () => applyWorldEdit(ws.history, prepared);
}
