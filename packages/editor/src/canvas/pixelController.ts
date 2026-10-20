import { manualEditAllowed } from "../agent/editGate";
import { useProjectLibrary } from "../io/projectLibrary";
/** Pointer samples only collect geometry. Planning/preview run once per animation frame;
 * a release prepares one guarded COW/world transaction. No PNG encoding on this path.
 */
import { WorldEditError, layerDrawList, formatHex, isTileLayer, parseHex, placedPixelSize, placedToSourcePixel, type MapStore, type PixelPoint } from '@smap/core';
import { Graphics } from 'pixi.js';
import { t } from '../i18n';
import { getLevelWorkspace, getProjectFolder, publishLevelState } from '../io/session';
import { readPixelSource } from '../io/pixelAssetIo';
import { useEditorStore } from '../state/editorStore';
import { usePixelColors } from '../state/pixelColors';
import { beforePixelModeChange, usePixelUi } from '../state/pixelUi';
import { toast } from '../ui/toast/toastStore';
import { snappedOffset } from './camera';
import { CANVAS_COLORS } from './colors';
import { applyPixelWrites, hasPixelLibraryReference, planPixelGesture, preparePixelCommit, rasterView, type PixelCellPlan, type PixelGestureOptions, type PixelTool } from './pixelEditing';
import type { ToolHost } from './toolController';

interface PixelGesture { pointerId: number; button: number; store: MapStore; revision: number; layerId: string; samples: PixelPoint[]; options: PixelGestureOptions; dirty: boolean; plans: PixelCellPlan[] }
export class PixelController {
  readonly metrics = { planMs: [] as number[], commitMs: [] as number[] };
  readonly cursor = new Graphics();
  #gesture: PixelGesture | null = null;
  #originDrag: { pointerId: number; store: MapStore; before: PixelPoint | undefined } | null = null;
  #generation = 0;
  readonly #host: ToolHost;
  readonly #unsubs: (() => void)[];
  get busy(): boolean { return !!this.#gesture || !!this.#originDrag; }
  constructor(host: ToolHost) {
    this.#host = host;
    this.#unsubs = [beforePixelModeChange(() => { this.cancel(); }), usePixelUi.subscribe((s, prev) => { if (s.mode !== prev.mode && s.mode === 'pixel') void this.warm(); if (s.mode !== prev.mode || s.size !== prev.size || s.shape !== prev.shape || s.mirrorH !== prev.mirrorH || s.mirrorV !== prev.mirrorV || s.originRevision !== prev.originRevision) host.requestRender(); })];
  }
  enabled(): boolean { const tool = useEditorStore.getState().tool; return usePixelUi.getState().mode === 'pixel' && !useEditorStore.getState().project?.levelId?.startsWith('stamp:') && tool !== 'hand' && tool !== 'select'; }
  destroy(): void { this.cancel(); for (const u of this.#unsubs) u(); this.cursor.destroy(); }
  async warm(): Promise<void> {
    const generation = ++this.#generation, ws = getLevelWorkspace(); if (!ws) return;
    usePixelUi.setState({ pending: true });
    try {
      const blockers: { mapId: string; reason: 'load' }[] = [];
      for (const map of ws.levels) { try { await ws.load(map.id, getProjectFolder()?.fs ?? null); ws.pin(map.id); } catch { blockers.push({ mapId: map.id, reason: 'load' }); } }
      if (blockers.length) throw new WorldEditError(blockers);
      // Warm source tiles of the visible/editable map outside pointer sampling.
      const doc = ws.active.store.document;
      for (const entry of doc.palette.entries()) { const ts = doc.getTileset(entry.tilesetId); if (ts && !ts.edited) readPixelSource(ts, entry.tileId); }
    } catch (error) { if (generation === this.#generation) toast.error(t('pixel.failed', { detail: this.failure(error) })); }
    finally { if (generation === this.#generation) usePixelUi.setState({ pending: false }); }
  }
  point(e: { clientX: number; clientY: number }): PixelPoint {
    const p = this.#host.toLocal(e), cam = this.#host.camera, off = snappedOffset(cam.camera, cam.resolution);
    return { x: Math.floor((p.x - off.x) / cam.camera.zoom), y: Math.floor((p.y - off.y) / cam.camera.zoom) };
  }
  down(e: PointerEvent): void {
    if (!manualEditAllowed()) return;
    if (!this.enabled() || (e.button !== 0 && e.button !== 2) || this.busy) return;
    e.preventDefault();
    const p = this.point(e), s = useEditorStore.getState(), store = this.#host.scene?.store;
    if (!store || !s.activeLayerId || usePixelUi.getState().pending) return;
    const map = store.document.map;
    if (p.x < 0 || p.y < 0 || p.x >= map.width * map.tileWidth || p.y >= map.height * map.tileHeight) return;
    const originUi = usePixelUi.getState(), origin = originUi.mirrorOrigins.get(store) ?? { x: (map.width * map.tileWidth - 1) / 2, y: (map.height * map.tileHeight - 1) / 2 };
    if (e.button === 0 && !e.altKey && (originUi.mirrorH || originUi.mirrorV) && Math.hypot(p.x - origin.x, p.y - origin.y) <= 8 / this.#host.camera.camera.zoom) {
      this.#originDrag = { pointerId: e.pointerId, store, before: originUi.mirrorOrigins.get(store) };
      this.#host.capture(e.pointerId); return;
    }
    const layer = store.document.getLayer(s.activeLayerId);
    if (s.tool === 'eyedropper' || e.altKey) { this.pick(p, e.shiftKey, e.button === 2); return; }
    const reason = !isTileLayer(layer) ? 'wrongKind' : layer.locked ? 'locked' : !layer.visible ? 'hidden' : null;
    if (reason) { this.#host.blocked?.({ reason, layerId: s.activeLayerId }); return; }
    const ui = usePixelUi.getState(), colors = usePixelColors.getState();
    const options: PixelGestureOptions = { tool: (e.button === 2 && s.tool === 'eraser' ? 'brush' : s.tool) as PixelTool, color: parseHex(e.button === 2 ? colors.bg : colors.fg)!, size: ui.size, shape: ui.shape, scope: ui.scope, fillMode: ui.fillMode, filled: ui.filled, mirrorH: ui.mirrorH, mirrorV: ui.mirrorV, ...(ui.mirrorOrigins.has(store) ? { mirrorOrigin: ui.mirrorOrigins.get(store)! } : {}) };
    this.#gesture = { pointerId: e.pointerId, button: e.button, store, revision: store.revision, layerId: s.activeLayerId, samples: [p], options, dirty: true, plans: [] };
    this.#host.capture(e.pointerId); this.#host.requestRender();
  }
  move(e: PointerEvent): void {
    const drag = this.#originDrag;
    if (drag && e.pointerId === drag.pointerId) {
      const map = drag.store.document.map, p = this.point(e), ui = usePixelUi.getState();
      ui.mirrorOrigins.set(drag.store, { x: Math.max(0, Math.min(map.width * map.tileWidth - 1, p.x)), y: Math.max(0, Math.min(map.height * map.tileHeight - 1, p.y)) });
      usePixelUi.setState({ originRevision: ui.originRevision + 1 }); return;
    }
    const g = this.#gesture; if (!g || e.pointerId !== g.pointerId) return;
    const events = e.getCoalescedEvents?.() ?? [];
    for (const sample of events.length ? events : [e]) { const p = this.point(sample), last = g.samples.at(-1)!; if (last.x !== p.x || last.y !== p.y) { g.samples.push(p); g.dirty = true; } } this.#host.requestRender();
  }
  up(e: PointerEvent): void {
    if (!manualEditAllowed(false)) { this.cancel(); return; }
    if (this.#originDrag && e.pointerId === this.#originDrag.pointerId && e.button === 0) { this.move(e); this.#originDrag = null; this.#host.release(e.pointerId); return; }
    const g = this.#gesture; if (!g || e.pointerId !== g.pointerId || e.button !== g.button) return;
    this.move(e); this.flush();
    this.#gesture = null;
    let committed = false;
    try {
      const ws = getLevelWorkspace();
      if (!ws || ws.active.store !== g.store || g.store.revision !== g.revision || useEditorStore.getState().activeLayerId !== g.layerId) return;
      const started = performance.now();
      preparePixelCommit(ws, g.layerId, g.plans, g.options.scope, readPixelSource, useProjectLibrary.getState().stamps)();
      committed = true;
      this.metrics.commitMs.push(performance.now() - started); if (this.metrics.commitMs.length > 256) this.metrics.commitMs.shift();
      if (g.plans.length) { if (g.options.tool !== 'eraser') usePixelColors.getState().addRecent(formatHex(g.options.color)); publishLevelState(); }
    } catch (error) { toast.error(t('pixel.failed', { detail: this.failure(error) })); }
    finally { this.#host.scene?.setPixelPreview(g.layerId, [], !committed); this.#host.release(g.pointerId); this.#host.requestRender(); }
  }
  flush(): void {
    const g = this.#gesture; if (!g || !g.dirty) return;
    if (g.store !== this.#host.scene?.store || g.store.revision !== g.revision) { this.cancel(); return; }
    g.dirty = false;
    const started = performance.now();
    try { g.plans = planPixelGesture(g.store, g.layerId, g.samples, g.options, readPixelSource); this.#host.scene?.setPixelPreview(g.layerId, g.plans.map(p => {
      const o = p.owner, ws = getLevelWorkspace(), ts = o.tilesetId ? g.store.document.getTileset(o.tilesetId) : undefined;
      const unique = ts?.edited && o.tileId! < ts.edited.nextTileId && !hasPixelLibraryReference(g.store.document, ts.id, o.tileId!, useProjectLibrary.getState().stamps) && o.width === ts.tileWidth && o.height === ts.tileHeight && ws?.cachedIds().reduce((n, id) => n + ws.entry(id)!.store.tileUsageCount(ts.id, o.tileId!), 0) === 1;
      return { ...o, data: applyPixelWrites(o, p.writes), previewRect: p.dirtyRect!, ...(unique ? { previewAsset: { assetId: ts.id, tileId: o.tileId! } } : {}) };
    })); }
    catch { this.cancel(); toast.error(t('pixel.sourceMissing')); }
    this.metrics.planMs.push(performance.now() - started); if (this.metrics.planMs.length > 256) this.metrics.planMs.shift();
  }
  cancel(): void {
    const drag = this.#originDrag; this.#originDrag = null;
    if (drag) {
      const ui = usePixelUi.getState();
      if (drag.before) ui.mirrorOrigins.set(drag.store, drag.before); else ui.mirrorOrigins.delete(drag.store);
      usePixelUi.setState({ originRevision: ui.originRevision + 1 }); this.#host.release(drag.pointerId);
    }
    const g = this.#gesture; this.#gesture = null;
    if (g) { this.#host.scene?.setPixelPreview(g.layerId, []); this.#host.release(g.pointerId); }
    this.#host.requestRender();
  }
  failure(error: unknown): string {
    if (error instanceof WorldEditError) {
      const ws = getLevelWorkspace();
      return error.blockers.map(b => {
        const name = ws?.level(b.mapId)?.name ?? b.mapId;
        const layer = b.layerId ? ws?.entry(b.mapId)?.store.document.getLayer(b.layerId)?.name : undefined;
        return `${name}${layer ? ` / ${layer}` : ''}: ${t(`pixel.blocker.${b.reason}`)}`;
      }).join('; ');
    }
    return t('pixel.sourceMissing');
  }
  draw(point: PixelPoint | null): void {
    this.cursor.visible = this.enabled();
    this.cursor.clear();
    const colors = this.#host.colors ?? CANVAS_COLORS;
    if (!this.cursor.visible) return;
    const guideUi = usePixelUi.getState(), guideStore = this.#host.scene?.store;
    if (guideStore && (guideUi.mirrorH || guideUi.mirrorV)) {
      const map = guideStore.document.map, width = map.width * map.tileWidth, height = map.height * map.tileHeight;
      const origin = guideUi.mirrorOrigins.get(guideStore) ?? { x: (width - 1) / 2, y: (height - 1) / 2 }, z = this.#host.camera.camera.zoom;
      if (guideUi.mirrorH) this.cursor.moveTo(0, origin.y + .5).lineTo(width, origin.y + .5);
      if (guideUi.mirrorV) this.cursor.moveTo(origin.x + .5, 0).lineTo(origin.x + .5, height);
      this.cursor.stroke({ color: colors.majorGrid, width: 1 / z });
      this.cursor.circle(origin.x + .5, origin.y + .5, 4 / z).stroke({ color: colors.accent, width: 1 / z });
    }
    if (!point) return;
    const ui = usePixelUi.getState(), size = ['brush', 'eraser', 'line'].includes(useEditorStore.getState().tool) ? ui.size : 1;
    const z = this.#host.camera.camera.zoom;
    const x = point.x - Math.floor(size / 2), y = point.y - Math.floor(size / 2);
    if (ui.shape === 'circle' && size > 1) this.cursor.ellipse(x + size / 2, y + size / 2, size / 2, size / 2);
    else this.cursor.rect(x, y, size, size);
    this.cursor.stroke({ color: colors.cursorShadow, width: 3 / z }).stroke({ color: colors.text, width: 1 / z });
    const store = this.#host.scene?.store, layerId = useEditorStore.getState().activeLayerId;
    if (store && layerId) {
      const map = store.document.map, anchor = this.#gesture?.samples[0] ?? point, cx = Math.floor(anchor.x / map.tileWidth), cy = Math.floor(anchor.y / map.tileHeight);
      const cell = store.document.getLayer(layerId)?.getCell(cx, cy) ?? 0, entry = store.document.palette.get(cell & 0x1fffffff), ts = entry ? store.document.getTileset(entry.tilesetId) : undefined;
      if (ts) { const extent = placedPixelSize(ts.tileWidth, ts.tileHeight, cell >>> 0); if (extent.width > map.tileWidth || extent.height > map.tileHeight) this.cursor.rect(cx * map.tileWidth, (cy + 1) * map.tileHeight - extent.height, extent.width, extent.height).stroke({ color: colors.text, width: 1 / z, alpha: .5 }); }
    }
  }
  pick(point: PixelPoint, active: boolean, background: boolean): void {
    const s = useEditorStore.getState(), store = this.#host.scene?.store; if (!store) return;
    let rgba = { r: 0, g: 0, b: 0, a: 0 };
    // The export draw list supplies the same native anchors, D4 and layer ordering.
    const list = layerDrawList(store.document, active && s.activeLayerId ? { layers: [s.activeLayerId] } : {});
    for (const layer of list.layers) for (const item of layer.items) {
      const { dest, src, tileset } = item;
      const local = { x: point.x - dest.x, y: point.y - dest.y };
      if (local.x < 0 || local.y < 0 || local.x >= dest.width || local.y >= dest.height) continue;
      const tileId = Math.floor((src.y - tileset.margin) / (tileset.tileHeight + tileset.spacing)) * tileset.columns + Math.floor((src.x - tileset.margin) / (tileset.tileWidth + tileset.spacing));
      const image = store.rasterAssets.getTile(tileset.id, tileId) ?? readPixelSource(tileset, tileId); if (!image) continue;
      const flags = ((item.flipH ? 0x80000000 : 0) | (item.flipV ? 0x40000000 : 0) | (item.flipD ? 0x20000000 : 0)) >>> 0;
      const p = placedToSourcePixel(local, image.width, image.height, flags), c = rasterView(image).get(p.x, p.y);
      if (active) { rgba = c; continue; }
      const sa = c.a / 255 * layer.opacity, da = rgba.a / 255, a = sa + da * (1 - sa);
      rgba = a ? { r: Math.round((c.r * sa + rgba.r * da * (1 - sa)) / a), g: Math.round((c.g * sa + rgba.g * da * (1 - sa)) / a), b: Math.round((c.b * sa + rgba.b * da * (1 - sa)) / a), a: Math.round(a * 255) } : rgba;
    }
    const colors = usePixelColors.getState(), hex = formatHex(rgba); (background ? colors.setBg : colors.setFg)(hex); colors.addRecent(hex);
  }
}
