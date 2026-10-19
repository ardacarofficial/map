import { bakeRecipeVersion } from "../../io/smartStampRecipes";
import { tilesetWorldVersion } from "../../state/tilesetImages";
import { formatSmartBrushError } from "../../commands/smartBrushErrors";
/**
 * Saving the brush clip as a library stamp (the brush card's "Kaydet").
 * The old "tileset.selection" inspector section is gone (round 4: the
 * brush card owns it).
 */
import { isEntityLayer, makeStampId, type MapDocument, type Stamp, type TileClip } from "@smap/core";

import { attachPreparedBrush, autoBrush, brushDisabled, brushUnavailable, waitForSelectionBrush } from "../../commands/smartBrushActions";
import { useSmartStampSession } from "../stamps/smartStampSession";
import { useEditorStore } from "../../state/editorStore";
import { isEmptyStamp, pickStamp } from "../../commands/stampActions";
import { t } from "../../i18n";
import { takenStampIds, useProjectLibrary } from "../../io/projectLibrary";
import { toast } from "../toast/toastStore";

/**
 * Saves a clip on the brush (tileset selection or map pick) as a library
 * stamp. Clip layers named after map layers that still exist take those
 * names, so placing the stamp later lands on the same layers.
 */
export async function saveClipAsStamp(doc: MapDocument, clip: TileClip, name: string): Promise<Stamp | null> {
  const world = tilesetWorldVersion();
  const recipe = bakeRecipeVersion(clip);
  let prepared;
  try {
    const unavailable=brushUnavailable(clip);if(autoBrush(clip)&&unavailable)throw unavailable;
    prepared = await waitForSelectionBrush(clip);
  }
  catch (error) { const detail=formatSmartBrushError(error);if(detail)toast.error(t("smartStamp.failed", { detail })); return null; }
  const editor = useEditorStore.getState();
  const currentClip = editor.stamp;
  if (!editor.project || !currentClip || tilesetWorldVersion() !== world || bakeRecipeVersion(currentClip) !== recipe) return null;
  doc = editor.project.store.document;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  const library = useProjectLibrary.getState();
  const source = prepared?.stamp ?? currentClip;
  const layers = source.layers.map((l) => {
    const target = doc.getLayer(currentClip.layers[source.layers.indexOf(l)]?.layerId ?? l.layerId);
    return target && !isEntityLayer(target) ? Object.freeze({ ...l, name: target.name }) : l;
  });
  const stamp: Stamp = Object.freeze({
    id: makeStampId(trimmed, takenStampIds(library)),
    name: trimmed,
    width: clip.width,
    height: clip.height,
    palette: source.palette,
    ...(prepared ? { nineSlice: prepared.stamp.nineSlice } : {}),
    ...(brushDisabled(currentClip) ? { smartDisabled: true } : {}),
    layers: Object.freeze(layers),
  });
  if (isEmptyStamp(stamp)) {
    toast.warning(t("toast.stampEmpty"));
    return null;
  }
  attachPreparedBrush(stamp, currentClip);
  library.addStamp(stamp);
  const orientation = useSmartStampSession.getState().orientation;
  pickStamp(stamp.id);
  useSmartStampSession.setState({ orientation });
  // Already on the brush: no "Fırçaya al" action.
  toast.success(t("toast.stampSaved", { name: stamp.name }));
  return stamp;
}
