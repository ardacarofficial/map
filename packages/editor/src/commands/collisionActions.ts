import { manualEditAllowed } from "../agent/editGate";
/** Manual Collision layer actions. */
import { COLLISION_PASSABLE, COLLISION_SOLID, isGridLayer, uniqueLayerName, type MapDocument, type TileLayer } from "@smap/core";
import { t } from "../i18n";
import { useEditorStore } from "../state/editorStore";
export function validGridValue(_doc: MapDocument, layer: TileLayer | undefined, gridValue: number): number {
  if (!isGridLayer(layer)) return gridValue;
  return gridValue === COLLISION_SOLID || gridValue === COLLISION_PASSABLE ? gridValue : COLLISION_SOLID;
}

/** "Collision" / "Collision 2" ... */
function uniqueCollisionName(doc: MapDocument): string {
  return uniqueLayerName(doc, t("layers.collisionName"));
}

/** Adds a collision (exceptions) layer right above the active one and makes it active. */
export function addCollisionLayer(): string | null {
  if (!manualEditAllowed()) return null;
  const state = useEditorStore.getState();
  const store = state.project?.store;
  if (!store || store.inTransaction) return null;
  const layers = store.document.layers;
  const activeIndex = layers.findIndex((l) => l.id === state.activeLayerId);
  const index = activeIndex >= 0 ? activeIndex + 1 : layers.length;
  const id = store.dispatch({
    type: "addLayer",
    layer: { type: "grid", role: "collision", name: uniqueCollisionName(store.document) },
    index,
  });
  state.setActiveLayer(id);
  state.setGridValue(COLLISION_SOLID);
  if (state.tool !== "brush" && state.tool !== "rect" && state.tool !== "fill" && state.tool !== "eraser") state.setTool("brush");
  return id;
}
