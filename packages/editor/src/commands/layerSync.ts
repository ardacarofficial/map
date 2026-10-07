/**
 * Keeps editor state consistent with the document after any change,
 * including undo / redo:
 * - `activeLayerId` always names an existing layer (falls back to the layer
 *   at the removed one's position);
 * - the marquee region stays inside the map after a resize;
 * - `gridValue` is a value the active grid layer accepts (collision: 1/2,
 *   terrain: a defined terrain id).
 */
import type { OpenProject } from "../state/editorStore";
import { useEditorStore } from "../state/editorStore";
import { clampRegion } from "./enablement";
import { validGridValue } from "./terrainActions";

export function installLayerSync(): () => void {
  let unsubscribe: (() => void) | null = null;
  let lastIndex = 0;

  const fix = (project: OpenProject) => {
    const state = useEditorStore.getState();
    const layers = project.store.document.layers;
    const index = layers.findIndex((l) => l.id === state.activeLayerId);
    if (index >= 0) {
      lastIndex = index;
    } else {
      const next = layers[Math.min(lastIndex, layers.length - 1)] ?? null;
      state.setActiveLayer(next?.id ?? null);
    }
    const { width, height } = project.store.document.map;
    const region = clampRegion(state.region, width, height);
    const r = state.region;
    if (r && (!region || region.x !== r.x || region.y !== r.y || region.width !== r.width || region.height !== r.height)) {
      state.setRegion(region);
    }
    const current = useEditorStore.getState();
    const active = current.activeLayerId ? project.store.document.getLayer(current.activeLayerId) : undefined;
    const value = validGridValue(project.store.document, active, current.gridValue);
    if (value !== current.gridValue) current.setGridValue(value);
  };

  const watch = (project: OpenProject | null) => {
    unsubscribe?.();
    unsubscribe = null;
    if (!project) return;
    fix(project);
    unsubscribe = project.store.subscribe((event) => {
      if (event.structure.includes("layers") || event.structure.includes("map") || event.structure.includes("tilesets")) {
        fix(project);
      }
    });
  };
  watch(useEditorStore.getState().project);
  const unsubscribeEditor = useEditorStore.subscribe((state, prev) => {
    if (state.project !== prev.project) watch(state.project);
    else if (state.activeLayerId !== prev.activeLayerId && state.project) fix(state.project);
  });
  return () => {
    unsubscribe?.();
    unsubscribeEditor();
  };
}
