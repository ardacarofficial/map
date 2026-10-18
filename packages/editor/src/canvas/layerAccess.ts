/**
 * Small adapters between core layers / clips and the pure tool logic in
 * `tools.ts`, shared by the tool controller and the overlay renderer.
 */
import {
  isEntityLayer,
  isGridLayer,
  stampLayerMapping,
  type GridLayer,
  type MapDocument,
  type MapStore,
  type Stamp,
  type TileClip,
  type TileLayer,
} from "@smap/core";

import { useEditorStore } from "../state/editorStore";
import { stampMapping, type LayerInfo } from "./tools";

/** Tool view of a layer (`doc` is accepted for callers that pass it; unused). */
export function layerInfo(layer: TileLayer, _doc?: MapDocument): LayerInfo {
  return {
    id: layer.id,
    visible: layer.visible,
    // Entity layers hold no cells (entities have their own tool).
    locked: layer.locked || isEntityLayer(layer),
    grid: isGridLayer(layer),
    getCell: (x, y) => layer.getCell(x, y),
  };
}

/** The editor's active layer in `store`, if it exists. */
export function activeLayer(store: MapStore | undefined): TileLayer | undefined {
  const id = useEditorStore.getState().activeLayerId;
  return id && store ? store.document.getLayer(id) : undefined;
}

/** The active layer when it is a grid layer. */
export function activeGridLayer(store: MapStore | undefined): GridLayer | undefined {
  const layer = activeLayer(store);
  return isGridLayer(layer) ? layer : undefined;
}

export function activeInfo(store: MapStore | undefined): LayerInfo | undefined {
  const layer = activeLayer(store);
  return layer ? layerInfo(layer, store?.document) : undefined;
}

/** Where each layer of `clip` is stamped (see `stampMapping`). */
export function mappingFor(store: MapStore | undefined, clip: TileClip): Record<string, string> {
  const doc = store?.document;
  if (!doc) return {};
  if (clip.layers.length > 1) return savedStampPreviewMapping(store, clip);
  return stampMapping(clip, useEditorStore.getState().activeLayerId, (id) => {
    const l = doc.getLayer(id);
    return l ? layerInfo(l, doc) : undefined;
  });
}

/**
 * The clip as a saved library stamp (it has an `id` and a `name`), else
 * null. Saved stamps are placed with core `placeStamp` (layers matched by
 * name / role, missing layers created in the same undo step).
 */
export function savedStamp(clip: TileClip | null | undefined): Stamp | null {
  const s = clip as Partial<Stamp> | null | undefined;
  return s && typeof s.id === "string" && typeof s.name === "string" ? (clip as Stamp) : null;
}

/** Placeholder target in {@link savedStampPreviewMapping} for a layer `placeStamp` will create. */
export const NEW_LAYER_TARGET = "\u0000new";

/**
 * Clip layer id → target layer id (or {@link NEW_LAYER_TARGET}) of the stamp
 * layers a saved stamp visibly places: `placeStamp` skips locked layers,
 * and hidden ones would not show, so both are left out of the preview.
 */
export function savedStampPreviewMapping(store: MapStore | undefined, stamp: TileClip): Record<string, string> {
  const doc = store?.document;
  if (!doc) return {};
  const out: Record<string, string> = {};
  for (const t of stampLayerMapping(doc, stamp)) {
    if (t.targetLayerId === null) {
      out[t.clipLayerId] = NEW_LAYER_TARGET;
      continue;
    }
    const l = doc.getLayer(t.targetLayerId);
    if (l && l.visible && !l.locked) out[t.clipLayerId] = t.targetLayerId;
  }
  return out;
}

const clipIds = new WeakMap<TileClip, number>();
let nextClipId = 1;

/** Stable small number per clip object (preview cache keys). */
export function clipId(clip: TileClip): number {
  let id = clipIds.get(clip);
  if (id === undefined) clipIds.set(clip, (id = nextClipId++));
  return id;
}
