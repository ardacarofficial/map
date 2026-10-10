/**
 * The terrain brush as the canvas sees it: on (Autotile), a terrain that
 * still exists, and a tile layer active (terrain is a brush on ordinary tile
 * layers; grid / entity layers never take it).
 */
import { getTerrainSet, isEntityLayer, isGridLayer, type MapStore, type TerrainBrush } from "@smap/core";

import { useEditorStore, type EditorState } from "../state/editorStore";

/** The brush the paint tools use on the active layer now, or null (paint tiles as usual). */
export function activeTerrainBrush(store: MapStore | undefined, s: EditorState = useEditorStore.getState()): TerrainBrush | null {
  if (!s.terrainActive || !s.terrain || !store) return null;
  const doc = store.document;
  const layer = s.activeLayerId ? doc.getLayer(s.activeLayerId) : undefined;
  if (!layer || isGridLayer(layer) || isEntityLayer(layer)) return null;
  const set = getTerrainSet(doc.getTileset(s.terrain.tilesetId), s.terrain.setId);
  if (!set || !set.terrains.some((t) => t.id === s.terrain!.terrainId)) return null;
  return { tilesetId: s.terrain.tilesetId, setId: s.terrain.setId, terrainId: s.terrain.terrainId };
}

/** Preview / cache key of a brush. */
export function terrainBrushKey(b: TerrainBrush): string {
  return `${b.tilesetId}/${b.setId}/${b.terrainId}`;
}
