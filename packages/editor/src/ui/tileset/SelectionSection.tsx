/**
 * Saving the brush clip as a library stamp (the brush card's "Kaydet").
 * The old "tileset.selection" inspector section is gone (round 4: the
 * brush card owns it).
 */
import { isEntityLayer, makeStampId, type MapDocument, type Stamp, type TileClip } from "@smap/core";

import { isEmptyStamp, pickStamp } from "../../commands/stampActions";
import { t } from "../../i18n";
import { takenStampIds, useProjectLibrary } from "../../io/projectLibrary";
import { toast } from "../toast/toastStore";

/**
 * Saves a clip on the brush (tileset selection or map pick) as a library
 * stamp. Clip layers named after map layers that still exist take those
 * names, so placing the stamp later lands on the same layers.
 */
export function saveClipAsStamp(doc: MapDocument, clip: TileClip, name: string): Stamp | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  const library = useProjectLibrary.getState();
  const layers = clip.layers.map((l) => {
    const target = doc.getLayer(l.layerId);
    return target && !isEntityLayer(target) ? Object.freeze({ ...l, name: target.name }) : l;
  });
  const stamp: Stamp = Object.freeze({
    id: makeStampId(trimmed, takenStampIds(library)),
    name: trimmed,
    width: clip.width,
    height: clip.height,
    palette: clip.palette,
    layers: Object.freeze(layers),
  });
  if (isEmptyStamp(stamp)) {
    toast.warning(t("toast.stampEmpty"));
    return null;
  }
  library.addStamp(stamp);
  pickStamp(stamp.id);
  // Already on the brush: no "Fırçaya al" action.
  toast.success(t("toast.stampSaved", { name: stamp.name }));
  return stamp;
}
