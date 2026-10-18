
import { isEntityLayer, isGridLayer, type MapStore, type TileLayer } from "@smap/core";

import type { OpenProject } from "../state/editorStore";
import { useEditorStore } from "../state/editorStore";
import { clampRegion } from "./enablement";
import { validGridValue } from "./collisionActions";

export function installLayerSync(): () => void {
  let unsubscribe: (() => void) | null = null;
  const memories = new WeakMap<MapStore, { ids: string[]; index: number; kind: string }>();
  const kindOf = (layer: TileLayer) => isEntityLayer(layer) ? "entity" : isGridLayer(layer) ? "collision" : "tile";

  const fix = (project: OpenProject) => {
    const state = useEditorStore.getState();
    const layers = project.store.document.layers;
    let memory = memories.get(project.store);
    if (!memory) {
      memory = { ids: [], index: 0, kind: "tile" };
      memories.set(project.store, memory);
    }
    const index = layers.findIndex((l) => l.id === state.activeLayerId);
    if (index >= 0) {
      memory.index = index;
      memory.kind = kindOf(layers[index]!);
      memory.ids = [layers[index]!.id, ...memory.ids.filter(id => id !== layers[index]!.id)].slice(0, 16);
    } else {
      const recent = memory.ids.map(id => layers.find(layer => layer.id === id)).find(layer => layer !== undefined);
      const position = Math.min(memory.index, layers.length - 1);
      const rank = (layer: TileLayer) => {
        const same = kindOf(layer) === memory.kind;
        if (same && layer.visible && !layer.locked) return 0;
        if (same && layer.visible) return 1;
        if (layer.visible && !layer.locked) return 2;
        return same ? 3 : 4;
      };
      const fallback = layers.map((layer, i) => ({ layer, i })).sort((a, b) => rank(a.layer) - rank(b.layer) || Math.abs(a.i - position) - Math.abs(b.i - position))[0]?.layer;
      const next = recent ?? fallback ?? null;
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
