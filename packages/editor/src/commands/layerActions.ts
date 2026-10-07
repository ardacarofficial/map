/**
 * Layer operations used by the layers panel and the command registry. All go
 * through core ops, so every one of them is undoable.
 */
import type { LayerPropsPatch, MapDocument, MapStore } from "@smap/core";
import { t } from "../i18n";
import { useEditorStore } from "../state/editorStore";
import { toast } from "../ui/toast/toastStore";

function current(): { store: MapStore; activeLayerId: string | null } | null {
  const { project, activeLayerId } = useEditorStore.getState();
  return project ? { store: project.store, activeLayerId } : null;
}

/** "Katman N" with the smallest N ≥ layer count + 1 that no layer uses. */
export function uniqueLayerName(doc: MapDocument): string {
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
  const id = c.store.dispatch({ type: "addLayer", layer: { name: uniqueLayerName(c.store.document) }, index });
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
  const depth = store.undoDepth;
  toast.withAction(t("toast.layerRemoved", { name: layer.name }), {
    label: t("common.undo"),
    run: () => {
      // Only undo the removal itself, not something done after it.
      if (useEditorStore.getState().project?.store !== store || store.undoDepth !== depth) return;
      store.undo();
      if (store.document.getLayer(layerId)) useEditorStore.getState().setActiveLayer(layerId);
    },
  });
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
