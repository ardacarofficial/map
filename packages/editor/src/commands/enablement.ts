/**
 * When edit / layer commands can run. Pure functions of the editor state so
 * they are testable without a DOM.
 */
import type { MapStore, TileLayer } from "@smap/core";
import type { CellRegion, EditorState } from "../state/editorStore";

export type EditContext = Pick<EditorState, "activeLayerId" | "region" | "stamp" | "selection"> & {
  store: MapStore | null;
  /** Selected entity (entity layers), if any. */
  selectedEntityId?: string | null;
};

export function contextOf(state: EditorState): EditContext {
  return {
    store: state.project?.store ?? null,
    activeLayerId: state.activeLayerId,
    region: state.region,
    stamp: state.stamp,
    selection: state.selection,
    selectedEntityId: state.selectedEntityId,
  };
}

export function activeLayer(c: EditContext): TileLayer | undefined {
  return c.activeLayerId ? c.store?.document.getLayer(c.activeLayerId) : undefined;
}

/** `region` clipped to the map, or null when nothing of it is inside. */
export function clampRegion(region: CellRegion | null, width: number, height: number): CellRegion | null {
  if (!region) return null;
  const x0 = Math.max(0, region.x);
  const y0 = Math.max(0, region.y);
  const x1 = Math.min(width, region.x + region.width);
  const y1 = Math.min(height, region.y + region.height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The selected region on the map, clipped to it. */
export function mapRegion(c: EditContext): CellRegion | null {
  const map = c.store?.document.map;
  return map ? clampRegion(c.region, map.width, map.height) : null;
}

export const canUndo = (c: EditContext): boolean => c.store?.canUndo ?? false;
export const canRedo = (c: EditContext): boolean => c.store?.canRedo ?? false;
export const canCopy = (c: EditContext): boolean => activeLayer(c) !== undefined && mapRegion(c) !== null;
/** Cut / delete change the layer: it must not be locked, and no stroke may be in progress. */
export const canErase = (c: EditContext): boolean =>
  canCopy(c) && !activeLayer(c)?.locked && !(c.store?.inTransaction ?? true);
export const canPaste = (c: EditContext): boolean => c.store !== null && activeLayer(c) !== undefined;
export const canSelectAll = (c: EditContext): boolean => c.store !== null;
export const canDeselect = (c: EditContext): boolean => c.region !== null || c.stamp !== null || hasSelectedEntity(c);
/** An entity is selected and still exists (Delete removes it, Esc deselects it). */
export const hasSelectedEntity = (c: EditContext): boolean =>
  !!c.selectedEntityId && c.store?.document.findEntity(c.selectedEntityId) !== undefined && !c.store.inTransaction;
export const canFlip = (c: EditContext): boolean =>
  c.stamp !== null || (c.selection !== null && activeLayer(c) !== undefined);
export const canRemoveLayer = (c: EditContext): boolean =>
  activeLayer(c) !== undefined && (c.store?.document.layers.length ?? 0) > 1 && !(c.store?.inTransaction ?? true);
