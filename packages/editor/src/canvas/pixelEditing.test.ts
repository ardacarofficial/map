import { createDocument, MapStore, makeCell, cellPaletteIndex, FLIP_H, serializeLevel, RasterAssets } from '@smap/core';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { planPixelGesture, preparePixelCommit, type PixelGestureOptions } from './pixelEditing';
import { LevelWorkspace } from '../io/levelWorkspace';

function setup(flags = 0) {
  const store = new MapStore(createDocument({ width: 4, height: 4, tileWidth: 16, tileHeight: 16, tilesets: [{ id: 'source', name: 'Source', imagePath: 'tilesets/source.png', tileWidth: 16, tileHeight: 16, columns: 1, rows: 1, margin: 0, spacing: 0 }] }), { rasterAssets: new RasterAssets() });
  const layerId = store.dispatch({ type: 'addLayer', layer: { name: 'Ground' } });
  const index = store.dispatch({ type: 'addPaletteEntry', tilesetId: 'source', tileId: 0 });
  store.dispatch({ type: 'paintCells', layerId, cells: [{ x: 0, y: 0, cell: makeCell(index, flags) }, { x: 1, y: 0, cell: index }] }); store.clearHistory();
  const ws = new LevelWorkspace({ name: 'World', levels: [{ id: 'a', name: 'A', path: 'levels/a.json', world: { x: 0, y: 0 } }], active: { id: 'a', store, knownText: null } });
  const bytes = new Uint8Array(16 * 16 * 4); bytes.fill(255);
  const source = () => ({ width: 16, height: 16, data: bytes, revision: 1 });
  return { store, layerId, ws, bytes, source };
}
const options: PixelGestureOptions = { tool: 'brush', color: { r: 255, g: 0, b: 0, a: 255 }, size: 1, shape: 'square', scope: 'cell', fillMode: 'contiguous', filled: false, mirrorH: false, mirrorV: false };

describe('pixel editing coordinator', () => {
  it('clones through inverse flips, leaves other usages/source unchanged, and records one undo', () => {
    const { store, layerId, ws, source, bytes } = setup(FLIP_H);
    const before = serializeLevel(store.document);
    const plans = planPixelGesture(store, layerId, [{ x: 0, y: 0 }, { x: 2, y: 0 }], options, source);
    preparePixelCommit(ws, layerId, plans, options.scope, source)();
    expect(ws.history.undoDepth).toBe(1);
    const cell = store.document.getLayer(layerId)!.getCell(0, 0);
    const entry = store.document.palette.get(cellPaletteIndex(cell))!;
    expect(entry.tilesetId).toBe('edited-16x16-1');
    const tile = store.rasterAssets.getTile(entry.tilesetId, entry.tileId)!;
    expect([...tile.data.slice(15 * 4, 16 * 4)]).toEqual([255, 0, 0, 255]);
    expect(store.document.getLayer(layerId)!.getCell(1, 0)).toBe(1);
    expect(bytes.every(v => v === 255)).toBe(true);
    ws.history.undo(); expect(serializeLevel(store.document)).toBe(before);
    ws.history.redo(); expect(store.rasterAssets.getTile(entry.tilesetId, entry.tileId)!.data).toEqual(tile.data);
  });
  it('remaps all world usages atomically with flags and one chronological history entry', () => {
    const { store, layerId, ws, source } = setup();
    const b = ws.add({ name: 'B', width: 4, height: 4, tileSize: 16, layerName: 'Ground' });
    const other = ws.entry(b.id)!.store, otherLayer = other.document.layers[0]!.id;
    const pi = other.dispatch({ type: 'addPaletteEntry', tilesetId: 'source', tileId: 0 });
    other.dispatch({ type: 'paintCells', layerId: otherLayer, cells: [{ x: 0, y: 0, cell: makeCell(pi, FLIP_H) }] });
    const before = ws.history.undoDepth;
    preparePixelCommit(ws, layerId, planPixelGesture(store, layerId, [{ x: 0, y: 0 }], options, source), 'world', source)();
    expect(ws.history.undoDepth).toBe(before + 1);
    expect(other.document.palette.get(cellPaletteIndex(other.document.getLayer(otherLayer)!.getCell(0, 0)))!.tilesetId).toBe('edited-16x16-1');
    ws.history.undo(); expect(other.document.getLayer(otherLayer)!.getCell(0, 0)).toBe(makeCell(pi, FLIP_H));
    other.dispatch({ type: 'setLayerProps', layerId: otherLayer, props: { locked: true } });
    expect(() => preparePixelCommit(ws, layerId, planPixelGesture(store, layerId, [{ x: 0, y: 0 }], options, source), 'world', source)).toThrow();
  });
  it('random tool/size/flip/scope histories restore visible document and source exactly', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 7 }), fc.array(fc.record({ tool: fc.constantFrom('brush', 'eraser', 'fill', 'line', 'rect'), size: fc.integer({ min: 1, max: 32 }), x: fc.integer({ min: 0, max: 31 }), y: fc.integer({ min: 0, max: 15 }), endX: fc.integer({ min: 0, max: 31 }), endY: fc.integer({ min: 0, max: 15 }), shape: fc.constantFrom('square', 'circle'), filled: fc.boolean(), global: fc.boolean(), mirrorH: fc.boolean(), mirrorV: fc.boolean(), world: fc.boolean(), undo: fc.boolean(), redo: fc.boolean() }), { maxLength: 12 }), (flip, strokes) => {
      const { store, layerId, ws, source, bytes } = setup((flip << 29) >>> 0), before = serializeLevel(store.document), original = bytes.slice();
      for (const stroke of strokes) {
        if (stroke.undo && ws.history.undoDepth) ws.history.undo();
        if (stroke.redo && ws.history.redoDepth) ws.history.redo();
        const o = { ...options, tool: stroke.tool, size: stroke.size, shape: stroke.shape, filled: stroke.filled, fillMode: stroke.global ? 'global' : 'contiguous', mirrorH: stroke.mirrorH, mirrorV: stroke.mirrorV, scope: stroke.world ? 'world' : 'cell' } as PixelGestureOptions;
        preparePixelCommit(ws, layerId, planPixelGesture(store, layerId, [{ x: stroke.x, y: stroke.y }, { x: stroke.endX, y: stroke.endY }], o, source), o.scope, source)();
      }
      const after = serializeLevel(store.document), doneDepth = ws.history.undoDepth;
      const rastersAfter = store.rasterAssets.assetIds().map(id => store.rasterAssets.getAsset(id)!.data);
      while (ws.history.undoDepth) ws.history.undo();
      expect(serializeLevel(store.document)).toBe(before); expect(bytes).toEqual(original);
      for (let i = 0; i < doneDepth; i++) ws.history.redo(); expect(serializeLevel(store.document)).toBe(after);
      expect(store.rasterAssets.assetIds().map(id => store.rasterAssets.getAsset(id)!.data)).toEqual(rastersAfter);
    }), { numRuns: 30 });
  }, 30_000);
});

it('patches uniquely owned edited slots, clones shared edited slots, and skips no-op strokes', () => {
  const { store, layerId, ws, source } = setup();
  const stroke = (x: number, y: number) => preparePixelCommit(ws, layerId, planPixelGesture(store, layerId, [{ x, y }], options, source), 'cell', source)();
  stroke(1, 1); const id = store.document.getLayer(layerId)!.getCell(0, 0), ts = store.document.tilesets.find(t => t.edited)!;
  stroke(2, 2); expect(store.document.getLayer(layerId)!.getCell(0, 0)).toBe(id); expect(store.document.getTileset(ts.id)!.edited!.nextTileId).toBe(1);
  const depth = ws.history.undoDepth; stroke(2, 2); expect(ws.history.undoDepth).toBe(depth);
  store.dispatch({ type: 'paintCells', layerId, cells: [{ x: 2, y: 0, cell: id }] });
  stroke(3, 3); expect(store.document.getLayer(layerId)!.getCell(0, 0)).not.toBe(id); expect(store.document.getLayer(layerId)!.getCell(2, 0)).toBe(id);
  expect(store.document.getTileset(ts.id)!.edited!.nextTileId).toBe(2);
});
it('creates transparent empty-cell rasters, clips map bounds, and merges all-world source writes', () => {
  const { store, layerId, ws, source } = setup();
  const plans = planPixelGesture(store, layerId, [{ x: 48, y: 48 }, { x: 80, y: 80 }], options, source);
  preparePixelCommit(ws, layerId, plans, 'cell', source)();
  const entry = store.document.palette.get(cellPaletteIndex(store.document.getLayer(layerId)!.getCell(3, 3)))!;
  const data = store.rasterAssets.getTile(entry.tilesetId, entry.tileId)!.data;
  expect([...data.slice(4, 8)]).toEqual([0, 0, 0, 0]);
  const worldPlans = planPixelGesture(store, layerId, [{ x: 1, y: 1 }, { x: 20, y: 1 }], options, source);
  preparePixelCommit(ws, layerId, worldPlans, 'world', source)();
  const a = store.document.getLayer(layerId)!.getCell(0, 0), b = store.document.getLayer(layerId)!.getCell(1, 0);
  expect(cellPaletteIndex(a)).toBe(cellPaletteIndex(b));
  const e = store.document.palette.get(cellPaletteIndex(a))!, tile = store.rasterAssets.getTile(e.tilesetId, e.tileId)!;
  expect([...tile.data.slice((16 + 4) * 4, (16 + 4) * 4 + 4)]).toEqual([255, 0, 0, 255]);
});
it('pads smaller artwork bottom-left and keeps oversized owner pixels without resampling across all D4 flags', () => {
  for (let flip = 0; flip < 8; flip++) {
    const { store, layerId } = setup((flip << 29) >>> 0);
    const small = () => ({ width: 8, height: 8, data: new Uint8Array(8 * 8 * 4).fill(255), revision: 1 });
    const plans = planPixelGesture(store, layerId, [{ x: 0, y: 0 }], options, small);
    expect(plans[0]!.owner.width).toBe(16); expect(plans[0]!.owner.height).toBe(16);
    expect(plans[0]!.writes).toHaveLength(1);
    const large = () => ({ width: 32, height: 32, data: new Uint8Array(32 * 32 * 4).fill(255), revision: 1 });
    const oversized = planPixelGesture(store, layerId, [{ x: 1, y: 1 }, { x: 20, y: 1 }], options, large);
    expect(oversized).toHaveLength(1); expect(oversized[0]!.owner.width).toBe(32); expect(oversized[0]!.writes).toHaveLength(20);
  }
});

it('maps a canonical source edit across rectangular D4 usages and different map cell sizes', async () => {
  const { sourceToPlacedPixel, placedToSourcePixel, placedPixelSize } = await import('@smap/core');
  for (let aFlip = 0; aFlip < 8; aFlip++) for (let bFlip = 0; bFlip < 8; bFlip++) {
    const ts = { id: 'source', name: 'Source', imagePath: 'source.png', tileWidth: 8, tileHeight: 12, columns: 1, rows: 1, margin: 0, spacing: 0 };
    const store = new MapStore(createDocument({ width: 2, height: 2, tileWidth: 16, tileHeight: 16, tilesets: [ts] }));
    const layerId = store.dispatch({ type: 'addLayer', layer: { name: 'Ground' } }), pi = store.dispatch({ type: 'addPaletteEntry', tilesetId: ts.id, tileId: 0 });
    store.dispatch({ type: 'paintCells', layerId, cells: [{ x: 0, y: 0, cell: makeCell(pi, (aFlip << 29) >>> 0) }] }); store.clearHistory();
    const ws = new LevelWorkspace({ name: 'World', levels: [{ id: 'a', name: 'A', path: 'a.json', world: { x: 0, y: 0 } }], active: { id: 'a', store, knownText: null } });
    const b = ws.add({ name: 'B', width: 2, height: 2, tileSize: 32, layerName: 'Ground' }), other = ws.entry(b.id)!.store, bLayer = other.document.layers[0]!.id;
    const bi = other.dispatch({ type: 'addPaletteEntry', tilesetId: ts.id, tileId: 0 }); other.dispatch({ type: 'paintCells', layerId: bLayer, cells: [{ x: 0, y: 0, cell: makeCell(bi, (bFlip << 29) >>> 0) }] });
    const source = () => ({ width: 8, height: 12, data: new Uint8Array(8 * 12 * 4).fill(255), revision: 0 });
    const aFlags = (aFlip << 29) >>> 0, bFlags = (bFlip << 29) >>> 0;
    const original = { x: 3, y: 4 }, p = sourceToPlacedPixel(original, 8, 12, aFlags), ae = placedPixelSize(8, 12, aFlags);
    preparePixelCommit(ws, layerId, planPixelGesture(store, layerId, [{ x: p.x, y: p.y + 16 - ae.height }], options, source), 'world', source)();
    const e = other.document.palette.get(cellPaletteIndex(other.document.getLayer(bLayer)!.getCell(0, 0)))!, raster = other.rasterAssets.getTile(e.tilesetId, e.tileId)!;
    const bp = sourceToPlacedPixel(original, 8, 12, bFlags), be = placedPixelSize(8, 12, bFlags), q = placedToSourcePixel({ x: bp.x, y: bp.y + 32 - be.height }, raster.width, raster.height, bFlags);
    expect([...raster.data.slice((q.y * raster.width + q.x) * 4, (q.y * raster.width + q.x) * 4 + 4)], `flags ${aFlip}/${bFlip}`).toEqual([255, 0, 0, 255]);
  }
}, 30_000);

it('does not mutate edited pixels referenced by a tile palette', () => {
  const { store, layerId, ws, source } = setup();
  preparePixelCommit(ws, layerId, planPixelGesture(store, layerId, [{ x: 1, y: 1 }], options, source), 'cell', source)();
  const e = store.document.palette.get(cellPaletteIndex(store.document.getLayer(layerId)!.getCell(0, 0)))!;
  const before = store.rasterAssets.getTile(e.tilesetId, e.tileId)!.data;
  store.dispatch({ type: 'setCollection', collection: { id: 'favorites', name: 'Favorites', columns: 2, rows: 2, cells: [{ x: 0, y: 0, tilesetId: e.tilesetId, tileId: e.tileId }] } });
  preparePixelCommit(ws, layerId, planPixelGesture(store, layerId, [{ x: 2, y: 2 }], options, source), 'cell', source)();
  expect(store.rasterAssets.getTile(e.tilesetId, e.tileId)!.data).toEqual(before);
  expect(store.document.palette.get(cellPaletteIndex(store.document.getLayer(layerId)!.getCell(0, 0)))!.tileId).not.toBe(e.tileId);
});
it('mirrors pencil coverage exactly about the map centre', () => {
  const { store, layerId, ws, source } = setup();
  const p = planPixelGesture(store, layerId, [{ x: 1, y: 1 }], { ...options, mirrorH: true, mirrorV: true }, source);
  expect(p.map(p => [p.cellX, p.cellY])).toEqual([[0, 0], [3, 0], [0, 3], [3, 3]]);
  preparePixelCommit(ws, layerId, p, 'cell', source)(); expect(ws.history.undoDepth).toBe(1); ws.history.undo(); expect(store.document.tilesets).toHaveLength(1);
});
it('world strokes keep the precise source identity captured at press', () => {
  const { store, layerId, source } = setup();
  store.dispatch({ type: 'addTileset', tileset: { ...store.document.tilesets[0]!, id: 'other', name: 'Other' } });
  const index = store.dispatch({ type: 'addPaletteEntry', tilesetId: 'other', tileId: 0 }); store.dispatch({ type: 'paintCells', layerId, cells: [{ x: 1, y: 0, cell: index }] });
  const plans = planPixelGesture(store, layerId, [{ x: 1, y: 1 }, { x: 18, y: 1 }], { ...options, scope: 'world' }, source);
  expect(plans.every(p => p.owner.tilesetId === 'source')).toBe(true);
});
it('uses the moved origin for stroke and fill reflection', () => {
  const { store, layerId, source } = setup();
  for (const tool of ['brush', 'fill'] as const) {
    const plans = planPixelGesture(store, layerId, [{ x: 1, y: 1 }], { ...options, tool, mirrorH: true, mirrorV: true, mirrorOrigin: { x: 9, y: 9 } }, source);
    expect(new Set(plans.map(p => `${p.cellX},${p.cellY}`))).toEqual(new Set(['0,0', '1,0', '0,1', '1,1']));
  }
});
