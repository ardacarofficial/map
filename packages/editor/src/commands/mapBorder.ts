import { buildRoadProfile, cellFlags, cellPaletteIndex, flipClip, isTileLayer, makeCell, mapBorder, planSmartStampArea, planSmartStampRoad, type MapBorderOptions, type MapStore, type Stamp, type Tileset, type CellRect } from "@smap/core";
import { create } from "zustand";
import { t, type MessageKey } from "../i18n";
import { useEditorStore } from "../state/editorStore";
import { activeSmartStamp, orientedBrushClip, useSmartStampSession } from "../ui/stamps/smartStampSession";
import { mappingFor } from "../canvas/layerAccess";
import { activeRandomSet, randomStampOf } from "../canvas/randomBrushSource";
import { planRandomPaint } from "../canvas/randomPaint";
import { patternCell, patternLayerIndex, type PreviewCell } from "../canvas/tools";
import { currentRandomSet } from "./randomBrush";
import { useProjectLibrary } from "../io/projectLibrary";
import { autoBrush, brushPending, brushPreviewTilesets, publishBrushAssets } from "./smartBrushActions";
import { toast } from "../ui/toast/toastStore";
import { registerCommands } from "./registry";

export interface BorderDraft extends MapBorderOptions { readonly store: MapStore }
export const useMapBorder = create<{ draft: BorderDraft | null }>(() => ({ draft: null }));
export function openMapBorder(): void {
  const store = useEditorStore.getState().project?.store;
  if (store && !store.inTransaction) useMapBorder.setState({ draft: { store, thickness: 1, inset: 0, gaps: [] } });
}
export function closeMapBorder(): void { cached = null; useMapBorder.setState({ draft: null }); }
export function updateMapBorder(patch: Partial<MapBorderOptions>): void {
  const draft = useMapBorder.getState().draft;
  if (draft) useMapBorder.setState({ draft: { ...draft, ...patch } });
}

/** One mutation-free plan feeds both the ghost and the transaction. Only the active tile layer is targeted. */
let cached: { keys: unknown[]; result: ReturnType<typeof buildBorderPlan> & { id: number; layerId: string | null; previewTilesets: readonly Tileset[] } } | null = null;
let planId = 0;
export function borderPlan(draft: BorderDraft) {
  const s = useEditorStore.getState();
  const keys = [draft, draft.store.revision, s.project?.store, s.activeLayerId, s.stamp, s.selection, currentRandomSet(), useSmartStampSession.getState().orientation, useSmartStampSession.getState().version, useProjectLibrary.getState().stamps];
  if (cached && keys.every((key, i) => key === cached!.keys[i])) return cached.result;
  const smart = activeSmartStamp(), previewTilesets = smart ? brushPreviewTilesets(smart) : [];
  let built: ReturnType<typeof buildBorderPlan>;
  try { built = buildBorderPlan(draft, previewTilesets); }
  catch {
    // Missing/stale authored assets are a disabled form state, never a React render error.
    built = { band: mapBorder(draft.store.document.map, { thickness: 1, inset: 0 }), cells: [], reason: "smartStamp.changed" };
  }
  const result = { ...built, previewTilesets, id: ++planId, layerId: s.activeLayerId };
  cached = { keys, result };
  return result;
}
function buildBorderPlan(draft: BorderDraft, previewTilesets: readonly Tileset[] = []) {
  const s = useEditorStore.getState(), doc = draft.store.document;
  const layer = s.activeLayerId ? doc.getLayer(s.activeLayerId) : undefined;
  let reason: MessageKey | null = null;
  if (s.project?.store !== draft.store || !isTileLayer(layer)) reason = "mapBorder.tileLayer";
  else if (layer.locked) reason = "canvas.blockedLocked";
  else if (!layer.visible) reason = "canvas.blockedHidden";
  const valid = [draft.thickness, draft.inset].every(Number.isSafeInteger) && draft.thickness >= 1 && draft.inset >= 0 && (draft.gaps ?? []).every(g => Number.isSafeInteger(g.start) && g.start >= 0 && Number.isSafeInteger(g.length) && g.length >= 1);
  if (!valid) reason = "mapBorder.invalid";
  const band = mapBorder(doc.map, valid ? draft : { thickness: 1, inset: 0 });
  const cells: PreviewCell[] = [];
  if (reason || !isTileLayer(layer)) return { band, cells, reason };
  if (brushPending()) return { band, cells, reason: autoBrush(s.stamp)?.failed ? "smartStamp.changed" as const : "smartStamp.preparing" as const };
  const member = new Set(band.cells.map(p => p.y * doc.map.width + p.x));
  const contains = (x: number, y: number) => doc.inBounds(x, y) && member.has(y * doc.map.width + x);
  const smart = activeSmartStamp();
  if (smart) {
    const orientation = useSmartStampSession.getState().orientation;
    const options = { revision: draft.store.revision, orientation };
    const staged = previewTilesets.some(t => !doc.getTileset(t.id));
    const roadSource = smart.nineSlice?.tileLayers.find(l => l.tilesetId === smart.nineSlice?.road?.tilesetId)?.layerId;
    const source = smart.layers.find(l => l.layerId === roadSource) ?? smart.layers.find(l => !l.grid);
    if (!source) return { band, cells, reason: "toast.blockedNoBrush" as const };
    let stamp: Stamp = { ...smart, layers: source ? [source] : [], nineSlice: { ...smart.nineSlice!, tileLayers: smart.nineSlice!.tileLayers.filter(l => l.layerId === source?.layerId) } };
    // Area-only nine-slice bakes already contain the canonical mask bank. Reuse
    // its core profile for a hollow border; never synthesize or publish a new asset.
    if (!stamp.nineSlice?.road && source) {
      const asset = stamp.nineSlice!.tileLayers[0];
      if (asset) {
        try {
          const profile = doc.getTileset(asset.tilesetId)?.roadProfile ?? buildRoadProfile(stamp, source.layerId);
          stamp = { ...stamp, nineSlice: { ...stamp.nineSlice!, road: { tilesetId: asset.tilesetId, profile } } };
        } catch { /* Authored area stamps with holes retain the area planner's skip semantics. */ }
      }
    }
    if (stamp.nineSlice?.road) {
      const membership = { bounds: band.rect, contains, cells: band.cells };
      // Staged assets are accepted only by windowed preview plans. Four strips cover
      // the complete perimeter plus repair halos without scanning the empty interior.
      const r = band.rect, t = band.thickness;
      const windows: readonly (CellRect | undefined)[] = staged ? [
        { ...r, height: t }, { ...r, y: r.y + r.height - t, height: t },
        { ...r, width: t }, { ...r, x: r.x + r.width - t, width: t },
      ] : [undefined];
      const writes = new Map<number, PreviewCell>();
      for (const window of windows) {
        const plan = planSmartStampRoad(doc, stamp, layer.id, membership, { ...options, ...(window ? { window, previewTilesets } : {}) });
        for (const l of plan.layers) for (const w of l.writes) if ("tile" in w && w.tile) writes.set(w.y * doc.map.width + w.x, { x: w.x, y: w.y, entry: w.tile, flags: w.flags ?? 0 });
      }
      cells.push(...[...writes.values()].sort((a, b) => a.y - b.y || a.x - b.x));
    } else {
      const plan = planSmartStampArea(doc, stamp, band.rect, { ...options, ...(staged ? { window: band.rect, previewTilesets } : {}), mapping: [{ clipLayerId: source.layerId, targetLayerId: layer.id, name: layer.name }] });
      for (const l of plan.layers) for (const w of l.writes) if ("tile" in w && w.tile && contains(w.x, w.y)) cells.push({ x: w.x, y: w.y, entry: w.tile, flags: w.flags ?? 0 });
    }
  } else {
    const random = activeRandomSet(doc, layer);
    if (random && !s.stamp) {
      const plan = planRandomPaint(random, doc.seed, band.cells);
      const result = new Map<number, PreviewCell>();
      for (const p of plan.tiles) result.set(p.y * doc.map.width + p.x, { ...p, entry: { tilesetId: p.tilesetId, tileId: p.tileId } });
      for (const p of plan.stamps) {
        let clip = randomStampOf(p.stampId);
        if (!clip) continue;
        if (p.flip.x) clip = flipClip(clip, "x") as Stamp;
        if (p.flip.y) clip = flipClip(clip, "y") as Stamp;
        const source = clip.layers[patternLayerIndex(clip, mappingFor(draft.store, clip), layer.id)];
        if (!source) continue;
        for (let i = 0; i < source.cells.length; i++) {
          const x = p.x + i % clip.width, y = p.y + Math.floor(i / clip.width), cell = source.cells[i]!;
          const entry = clip.palette[cellPaletteIndex(cell) - 1];
          if (entry && contains(x, y)) result.set(y * doc.map.width + x, { x, y, entry, flags: cellFlags(cell) });
        }
      }
      cells.push(...result.values());
    } else if (s.stamp) {
      const clip = orientedBrushClip(s.stamp), li = patternLayerIndex(clip, mappingFor(draft.store, clip), layer.id);
      for (const p of band.cells) {
        const cell = patternCell(clip, li, p.x, p.y, band.rect.x, band.rect.y), entry = clip.palette[cellPaletteIndex(cell) - 1];
        if (entry) cells.push({ ...p, entry, flags: cellFlags(cell) });
      }
    } else if (s.selection && doc.getTileset(s.selection.tilesetId)) {
      for (const p of band.cells) cells.push({ ...p, entry: s.selection, flags: 0 });
    } else reason = "toast.blockedNoBrush";
  }
  return { band, cells, reason };
}

export function commitMapBorder(): boolean {
  const draft = useMapBorder.getState().draft;
  if (!draft || draft.store.inTransaction) return false;
  const state = useEditorStore.getState(), plan = borderPlan(draft), layerId = state.activeLayerId;
  if (plan.reason || !layerId || !plan.cells.length) return false;
  const store = draft.store;
  store.beginTransaction(t("mapBorder.history"));
  try {
    if (activeSmartStamp()) publishBrushAssets(state.stamp, store);
    // Replan against published document metadata, with normal apply-time validation.
    const applied = buildBorderPlan(draft);
    if (applied.reason || !applied.cells.length) { store.rollback(); return false; }
    store.dispatch({ type: "paintCells", layerId, cells: applied.cells.map(p => ({ x: p.x, y: p.y, cell: makeCell(store.getOrAddPaletteIndex(p.entry.tilesetId, p.entry.tileId), p.flags) })) });
    store.commit();
    closeMapBorder();
    return true;
  } catch { store.rollback(); toast.error(t("smartStamp.changed")); return false; }
}
export function registerMapBorderCommand(): void {
  registerCommands([{ id: "map.border", title: "mapBorder.title", category: "map", enabled: () => !!useEditorStore.getState().project, run: openMapBorder }]);
}
