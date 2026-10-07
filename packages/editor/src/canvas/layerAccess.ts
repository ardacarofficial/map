/**
 * Small adapters between core layers / clips and the pure tool logic in
 * `tools.ts`, shared by the tool controller and the overlay renderer.
 */
import { isGridLayer, type GridLayer, type MapStore, type TileClip, type TileLayer } from "@smap/core";

import { useEditorStore } from "../state/editorStore";
import { stampMapping, type LayerInfo } from "./tools";

export function layerInfo(layer: TileLayer): LayerInfo {
  return {
    id: layer.id,
    visible: layer.visible,
    locked: layer.locked,
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
  return layer ? layerInfo(layer) : undefined;
}

/** Where each layer of `clip` is stamped (see `stampMapping`). */
export function mappingFor(store: MapStore | undefined, clip: TileClip): Record<string, string> {
  const doc = store?.document;
  if (!doc) return {};
  return stampMapping(clip, useEditorStore.getState().activeLayerId, (id) => {
    const l = doc.getLayer(id);
    return l ? layerInfo(l) : undefined;
  });
}

const clipIds = new WeakMap<TileClip, number>();
let nextClipId = 1;

/** Stable small number per clip object (preview cache keys). */
export function clipId(clip: TileClip): number {
  let id = clipIds.get(clip);
  if (id === undefined) clipIds.set(clip, (id = nextClipId++));
  return id;
}
