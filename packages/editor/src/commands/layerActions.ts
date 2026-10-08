/**
 * Layer operations used by the layers panel and the command registry. All go
 * through core ops, so every one of them is undoable.
 */
import { isEntityLayer, isGridLayer, isTileLayer, selectAllContent, uniqueLayerName, type LayerPropsPatch, type MapDocument, type MapStore } from "@smap/core";
import { create } from "zustand";

import { t } from "../i18n";
import { useEditorStore } from "../state/editorStore";
import { layerUnits, moveUnitOrder, unitIndexOf, type LayerUnit } from "../ui/terrain/layerGroups";
import { toast } from "../ui/toast/toastStore";
import { removeTerrainGroup } from "./terrainActions";
import { undoStepAction } from "./undoStepAction";

function current(): { store: MapStore; activeLayerId: string | null } | null {
  const { project, activeLayerId } = useEditorStore.getState();
  return project ? { store: project.store, activeLayerId } : null;
}

/** "Katman N" with the smallest N ≥ layer count + 1 that no layer uses. */
export function newLayerName(doc: MapDocument): string {
  const names = new Set(doc.layers.map((l) => l.name));
  for (let n = doc.layers.length + 1; ; n++) {
    const name = t("layers.newName", { n });
    if (!names.has(name)) return name;
  }
}

/** Adds an empty tile layer right above the active one and makes it active. */
export function addLayer(): string | null {
  const c = current();
  if (!c) return null;
  const layers = c.store.document.layers;
  const activeIndex = layers.findIndex((l) => l.id === c.activeLayerId);
  const index = activeIndex >= 0 ? activeIndex + 1 : layers.length;
  const id = c.store.dispatch({ type: "addLayer", layer: { name: newLayerName(c.store.document) }, index });
  useEditorStore.getState().setActiveLayer(id);
  return id;
}

/** Deletes a layer (undoable, so no confirmation) and offers "Geri al" in a toast. */
export function removeLayer(layerId: string): boolean {
  const c = current();
  if (!c) return false;
  const { store } = c;
  const layers = store.document.layers;
  const index = layers.findIndex((l) => l.id === layerId);
  const layer = layers[index];
  if (!layer || layers.length <= 1 || store.inTransaction) return false;
  store.dispatch({ type: "removeLayer", layerId });
  if (c.activeLayerId === layerId) {
    const next = store.document.layers[Math.min(index, store.document.layers.length - 1)] ?? null;
    useEditorStore.getState().setActiveLayer(next?.id ?? null);
  }
  // Only undoes the removal itself, not something done after it.
  toast.withAction(
    t("toast.layerRemoved", { name: layer.name }),
    undoStepAction(store, () => {
      if (store.document.getLayer(layerId)) useEditorStore.getState().setActiveLayer(layerId);
    }),
  );
  return true;
}

export function setLayerProps(layerId: string, props: LayerPropsPatch): void {
  const store = current()?.store;
  if (!store?.document.getLayer(layerId)) return;
  store.dispatch({ type: "setLayerProps", layerId, props });
}

export function renameLayer(layerId: string, name: string): void {
  const trimmed = name.trim();
  const layer = current()?.store.document.getLayer(layerId);
  if (!layer || trimmed.length === 0 || trimmed === layer.name) return;
  setLayerProps(layerId, { name: trimmed });
}

/** Moves a layer to `index` (from the bottom, core order). */
export function moveLayer(layerId: string, index: number): void {
  const store = current()?.store;
  const layers = store?.document.layers;
  if (!store || !layers) return;
  const from = layers.findIndex((l) => l.id === layerId);
  if (from < 0 || from === index || index < 0 || index >= layers.length) return;
  store.dispatch({ type: "moveLayer", layerId, index });
}

/**
 * Opacity slider drag: every change is applied live (the canvas shows it),
 * and the whole drag becomes one undo step.
 */
export const opacityDrag = {
  store: null as MapStore | null,
  change(layerId: string, opacity: number): void {
    const store = current()?.store;
    if (!store?.document.getLayer(layerId)) return;
    if (this.store !== store) {
      this.end();
      store.beginTransaction();
      this.store = store;
    }
    store.dispatch({ type: "setLayerProps", layerId, props: { opacity } });
  },
  end(): void {
    const store = this.store;
    this.store = null;
    if (store?.inTransaction) store.commit();
  },
};

// ------------------------------------------------------------------ round 3: layer commands

/**
 * Requests the layers panel acts on (it owns the inline editors): F2 starts
 * renaming a layer, "Opaklık…" focuses the opacity slider.
 */
interface LayerUiState {
  renamingId: string | null;
  /** Bumped by every "Opaklık…" request. */
  opacityFocus: number;
}

export const useLayerUi = create<LayerUiState>()(() => ({ renamingId: null, opacityFocus: 0 }));

export function startLayerRename(layerId: string | null): void {
  useLayerUi.setState({ renamingId: layerId });
}

export function requestOpacityFocus(): void {
  useLayerUi.setState((s) => ({ opacityFocus: s.opacityFocus + 1 }));
}

/** The unit (layer, or terrain layer + its derived tiles) that contains `layerId`, with its index (top first). */
export function unitOf(doc: MapDocument, layerId: string | null): { units: LayerUnit[]; index: number; unit: LayerUnit | undefined } {
  const units = layerUnits(doc);
  const index = unitIndexOf(units, layerId);
  return { units, index, unit: units[index] };
}

/** Ids of the layers of a unit. */
export function unitLayerIds(unit: LayerUnit): string[] {
  return unit.child ? [unit.head.id, unit.child.id] : [unit.head.id];
}

/** Can the unit of `layerId` move one step up (toward the top) / down? */
export function canMoveUnit(doc: MapDocument | undefined, layerId: string | null, dir: "up" | "down"): boolean {
  if (!doc) return false;
  const { units, index } = unitOf(doc, layerId);
  if (index < 0) return false;
  return dir === "up" ? index > 0 : index < units.length - 1;
}

/** Moves the unit of `layerId` one step up / down (a terrain group as a whole), one undo step. */
export function moveUnit(layerId: string, dir: "up" | "down"): boolean {
  const store = current()?.store;
  if (!store || store.inTransaction) return false;
  const { units, index } = unitOf(store.document, layerId);
  if (index < 0) return false;
  const to = dir === "up" ? index - 1 : index + 1;
  if (to < 0 || to >= units.length) return false;
  applyOrder(store, moveUnitOrder(units, index, to));
  return true;
}

/** Reorders layers to `order` (bottom first) inside the open / a new transaction. */
function applyOrder(store: MapStore, order: readonly string[]): void {
  store.beginTransaction();
  try {
    for (let i = 0; i < order.length; i++) {
      if (store.document.layers[i]?.id !== order[i]) store.dispatch({ type: "moveLayer", layerId: order[i]!, index: i });
    }
    store.commit();
  } catch (error) {
    store.rollback();
    throw error;
  }
}

/** "Zemin kopya" (the next free "… kopya 2" when taken). */
export function copyLayerName(doc: MapDocument, name: string): string {
  return uniqueLayerName(doc, t("layers.copyName", { name }));
}

/**
 * Duplicates the unit of `layerId` right above it (a terrain group copies
 * both layers and stays a group) and makes the copy active. One undo step.
 */
export function duplicateLayer(layerId: string): string | null {
  const store = current()?.store;
  if (!store || store.inTransaction) return null;
  const doc = store.document;
  const { unit } = unitOf(doc, layerId);
  if (!unit) return null;
  store.beginTransaction();
  let id: string;
  try {
    if (unit.child) {
      // Terrain pair "Çimen" + "Çimen (arazi)" → "Çimen kopya" + "Çimen kopya (arazi)".
      const tilesName = copyLayerName(doc, unit.child.name);
      const name = uniqueLayerName(doc, t("terrain.layerName", { name: tilesName }), [tilesName]);
      id = store.dispatch({ type: "duplicateLayer", layerId: unit.head.id, name, targetName: tilesName });
    } else {
      id = store.dispatch({ type: "duplicateLayer", layerId: unit.head.id, name: copyLayerName(doc, unit.head.name) });
    }
    const copy = doc.getLayer(id);
    if (unit.child && isGridLayer(copy) && copy.targetLayerId) {
      // Keep the copy a group: [… child, head, copyTiles, copyGrid …] (bottom first).
      const copyTiles = copy.targetLayerId;
      const rest = doc.layers.map((l) => l.id).filter((x) => x !== copyTiles && x !== id);
      const at = rest.indexOf(unit.head.id) + 1;
      applyOrder(store, [...rest.slice(0, at), copyTiles, id, ...rest.slice(at)]);
    }
    store.commit();
  } catch (error) {
    store.rollback();
    console.error(error);
    return null;
  }
  useEditorStore.getState().setActiveLayer(id);
  return id;
}

/** Why "Aşağıyla birleştir" cannot run for `layerId`, or null when it can. */
export function mergeDownProblem(doc: MapDocument | undefined, layerId: string | null): "notTile" | "noBelow" | "belowNotTile" | "locked" | "derived" | null {
  const layer = layerId ? doc?.getLayer(layerId) : undefined;
  if (!doc || !layer || !isTileLayer(layer)) return "notTile";
  const below = doc.layers[doc.indexOfLayer(layer.id) - 1];
  if (!below) return "noBelow";
  if (!isTileLayer(below)) return "belowNotTile";
  if (layer.locked || below.locked) return "locked";
  const derived = (id: string) => doc.layers.some((l) => isGridLayer(l) && l.role === "terrain" && l.targetLayerId === id);
  if (derived(layer.id) || derived(below.id)) return "derived";
  return null;
}

/** Merges a tile layer into the one below (one undo step); the lower layer becomes active. */
export function mergeLayerDown(layerId: string): boolean {
  const store = current()?.store;
  if (!store || store.inTransaction || mergeDownProblem(store.document, layerId) !== null) return false;
  const name = store.document.getLayer(layerId)?.name ?? "";
  let lower: string;
  try {
    lower = store.dispatch({ type: "mergeLayerDown", layerId });
  } catch (error) {
    console.error(error);
    return false;
  }
  useEditorStore.getState().setActiveLayer(lower);
  toast.withAction(t("toast.layerMerged", { name, below: store.document.getLayer(lower)?.name ?? "" }), undoStepAction(store));
  return true;
}

/** Same props on every layer of the unit of `layerId` (a group hides / locks as a whole), one undo step. */
export function setUnitProps(layerId: string, props: LayerPropsPatch): void {
  const store = current()?.store;
  if (!store || store.inTransaction) return;
  const { unit } = unitOf(store.document, layerId);
  if (!unit) return;
  store.beginTransaction();
  try {
    for (const id of unitLayerIds(unit)) store.dispatch({ type: "setLayerProps", layerId: id, props });
    store.commit();
  } catch (error) {
    store.rollback();
    throw error;
  }
}

/** Whether every layer except the unit of `layerId` is hidden and the unit itself is visible. */
export function isSolo(doc: MapDocument, layerId: string): boolean {
  const { unit } = unitOf(doc, layerId);
  if (!unit) return false;
  const own = new Set(unitLayerIds(unit));
  return doc.layers.every((l) => (own.has(l.id) ? l.visible : !l.visible)) && doc.layers.length > own.size;
}

/**
 * "Yalnız bunu göster" (Alt+click on the eye): shows only the unit of
 * `layerId`; when it already is the only one shown, shows every layer
 * again. One undo step.
 */
export function soloLayer(layerId: string): void {
  const store = current()?.store;
  if (!store || store.inTransaction) return;
  const doc = store.document;
  const { unit } = unitOf(doc, layerId);
  if (!unit) return;
  const own = new Set(unitLayerIds(unit));
  const showAll = isSolo(doc, layerId);
  store.beginTransaction();
  try {
    for (const l of doc.layers) {
      const visible = showAll || own.has(l.id);
      if (l.visible !== visible) store.dispatch({ type: "setLayerProps", layerId: l.id, props: { visible } });
    }
    store.commit();
  } catch (error) {
    store.rollback();
    throw error;
  }
}

/** "Bu katmandakileri seç": the marquee around everything on the layer (entity layers: around their entities). */
export function selectLayerContent(layerId: string): boolean {
  const state = useEditorStore.getState();
  const doc = state.project?.store.document;
  if (!doc?.getLayer(layerId)) return false;
  const rect = selectAllContent(doc, layerId);
  if (!rect) {
    toast.info(t("toast.layerEmpty"));
    return false;
  }
  state.setActiveLayer(layerId);
  if (!isEntityLayer(doc.getLayer(layerId)) && state.tool !== "select") state.setTool("select");
  state.setRegion(rect);
  return true;
}

/** Removes the unit of `layerId` (a terrain group as a whole), with "Geri al" in the toast. */
export function removeUnit(layerId: string): boolean {
  const doc = current()?.store.document;
  if (!doc) return false;
  const { unit } = unitOf(doc, layerId);
  if (!unit) return false;
  return unit.child ? removeTerrainGroup(unit.head.id) : removeLayer(unit.head.id);
}

/** Can the unit of `layerId` be removed (the map keeps at least one layer)? */
export function canRemoveUnit(doc: MapDocument | undefined, layerId: string | null): boolean {
  if (!doc) return false;
  const { unit } = unitOf(doc, layerId);
  return !!unit && doc.layers.length > unitLayerIds(unit).length;
}
