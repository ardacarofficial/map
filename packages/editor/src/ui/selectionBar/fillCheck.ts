import { COLLISION_PASSABLE, COLLISION_SOLID, isEntityLayer, isGridLayer, type MapDocument } from "@smap/core";

import { isRandomBrush } from "../../canvas/randomPaint";
import type { MessageKey } from "../../i18n";
import type { EditorState } from "../../state/editorStore";
import { terrainOwnerOf } from "../../commands/terrainActions";

/**
 * Why "Doldur" cannot fill the selection right now (a message key for the
 * tooltip), or null when it can: the active layer must take paint and the
 * brush must hold something for it.
 */
export function fillBlocker(
  doc: MapDocument | undefined,
  s: Pick<EditorState, "activeLayerId" | "gridValue" | "stamp" | "selection" | "randomSet">,
): MessageKey | null {
  const layer = doc && s.activeLayerId ? doc.getLayer(s.activeLayerId) : undefined;
  if (!doc || !layer) return "selectionBar.fillNoLayer";
  if (isEntityLayer(layer)) return "selectionBar.fillEntity";
  if (layer.locked) return "selectionBar.fillLocked";
  if (terrainOwnerOf(doc, layer.id)) return "selectionBar.fillDerived";
  if (isGridLayer(layer)) {
    if (layer.role === "collision") return s.gridValue === COLLISION_SOLID || s.gridValue === COLLISION_PASSABLE ? null : "selectionBar.fillNoBrush";
    return doc.terrainMap().has(s.gridValue) ? null : "selectionBar.fillNoTerrain";
  }
  if (s.stamp || isRandomBrush(s.randomSet)) return null;
  return s.selection && doc.getTileset(s.selection.tilesetId) ? null : "selectionBar.fillNoBrush";
}
