/** Multi-layer clips share stamp matching, but capture targets once per gesture. */
import { stampLayerMapping, type MapDocument, type MapStore, type TileClip } from "@smap/core";
import { reportSelectionSkipped, survivingSelectionIds } from "./selectionScope";

/** Must run inside the placement transaction so created layers undo with their cells. */
export function prepareSelectionPaste(store: MapStore, clip: TileClip): Record<string, string> {
  const mapping: Record<string, string> = {};
  const skipped: string[] = [];
  let previous: string | null = null;
  for (const entry of stampLayerMapping(store.document, clip)) {
    let id = entry.targetLayerId;
    if (id === null) {
      const source = clip.layers.find(l => l.layerId === entry.clipLayerId)!;
      id = store.dispatch({ type: "addLayer", layer: source.grid
        ? { name: source.name, type: "grid", role: source.role ?? "terrain" }
        : { name: source.name }, index: previous === null ? 0 : store.document.indexOfLayer(previous) + 1 });
    }
    previous = id;
    const target = store.document.getLayer(id)!;
    if (target.locked || !target.visible) skipped.push(target.name);
    else mapping[entry.clipLayerId] = id;
  }
  reportSelectionSkipped(skipped);
  return Object.freeze(mapping);
}

/** Revalidate only the captured mapping; the preview and placement share it. */
export function survivingPasteMapping(doc: MapDocument, mapping: Record<string, string>): Record<string, string> {
  const ids = new Set(survivingSelectionIds(doc, Object.values(mapping)));
  return Object.fromEntries(Object.entries(mapping).filter(([, id]) => ids.has(id)));
}
