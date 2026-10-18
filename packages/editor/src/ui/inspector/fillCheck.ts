import { COLLISION_PASSABLE, COLLISION_SOLID, isEntityLayer, isGridLayer, type MapDocument } from "@smap/core";

import { isRandomBrush } from "../../canvas/randomPaint";
import type { MessageKey } from "../../i18n";
import type { EditorState } from "../../state/editorStore";

/**
 * Why "Doldur" cannot fill the selection right now (a message key for the
 * tooltip), or null when it can: the active layer must take paint and the
 * brush must hold something for it.
 */
export function fillBlocker(
  doc: MapDocument | undefined,
  s: Pick<EditorState, "activeLayerId" | "gridValue" | "stamp" | "selection" | "randomSet"> & {
    /** The random brush is active (also stamp candidates / scatter, see `currentRandomSet`). */
    readonly random?: boolean;

  },
): MessageKey | null {
  const layer = doc && s.activeLayerId ? doc.getLayer(s.activeLayerId) : undefined;
  if (!doc || !layer) return "selectionBar.fillNoLayer";
  if (isEntityLayer(layer)) return "selectionBar.fillEntity";
  if (layer.locked) return "selectionBar.fillLocked";
  if (!layer.visible) return "selectionBar.fillHidden";
  if (isGridLayer(layer)) return s.gridValue === COLLISION_SOLID || s.gridValue === COLLISION_PASSABLE ? null : "selectionBar.fillNoBrush";
  if (s.stamp || s.random || isRandomBrush(s.randomSet)) return null;
  return s.selection && doc.getTileset(s.selection.tilesetId) ? null : "selectionBar.fillNoBrush";
}
