/**
 * Stamp library actions (v0.6): save the marquee as a multi-layer stamp,
 * make a stamp the brush, rename, delete. Stamps are flat copies: placing
 * one keeps no link back to the library (CLAUDE.md → Yapılmayacaklar).
 */
import { copyRegion, createStamp, isEntityLayer, makeStampId, type CellRect, type MapDocument, type Stamp } from "@smap/core";

import { t } from "../i18n";
import { takenStampIds, useProjectLibrary } from "../io/projectLibrary";
import { useEditorStore } from "../state/editorStore";
import { toast } from "../ui/toast/toastStore";
import { useUiStore } from "../ui/uiStore";
import { contextOf, mapRegion } from "./enablement";

/** The map region a stamp would be saved from (marquee clipped to the map), or null. */
export function stampRegion() {
  return mapRegion(contextOf(useEditorStore.getState()));
}

/** Layers a stamp saves: every tile and grid layer (collision included), bottom to top. */
export function stampLayerIds(doc: MapDocument): string[] {
  return doc.layers.filter((l) => !isEntityLayer(l)).map((l) => l.id);
}

/**
 * The layers a stamp of `region` keeps: those with at least one non-empty
 * cell there (empty layers would only add empty layers where it is placed).
 */
export function usedStampLayerIds(doc: MapDocument, region: CellRect): string[] {
  const clip = copyRegion(doc, stampLayerIds(doc), region);
  return clip.layers.filter((l) => l.cells.some((c) => c !== 0)).map((l) => l.layerId);
}

/** True when no layer of the stamp has a non-empty cell. */
export function isEmptyStamp(stamp: Stamp): boolean {
  return stamp.layers.every((l) => l.cells.every((c) => c === 0));
}

/** "Stamp N" with the smallest N that no stamp uses. */
export function defaultStampName(stamps: readonly Stamp[]): string {
  const names = new Set(stamps.map((s) => s.name));
  for (let n = stamps.length + 1; ; n++) {
    const name = t("stamps.defaultName", { n });
    if (!names.has(name)) return name;
  }
}

/** Saves the marquee of all layers as a stamp named `name`. Returns it, or null (nothing saved). */
export function saveSelectionAsStamp(name: string): Stamp | null {
  const { project } = useEditorStore.getState();
  const region = stampRegion();
  const trimmed = name.trim();
  if (!project || !region || trimmed.length === 0) return null;
  const doc = project.store.document;
  const library = useProjectLibrary.getState();
  let stamp: Stamp;
  try {
    const used = usedStampLayerIds(doc, region);
    stamp = createStamp(doc, used.length > 0 ? used : stampLayerIds(doc), region, { id: makeStampId(trimmed, takenStampIds(library)), name: trimmed });
  } catch (error) {
    console.error(error);
    toast.error(t("toast.stampFailed", { detail: error instanceof Error ? error.message : String(error) }));
    return null;
  }
  if (isEmptyStamp(stamp)) {
    toast.warning(t("toast.stampEmpty"));
    return null;
  }
  library.addStamp(stamp);
  useUiStore.getState().setLibraryTab("stamps");
  toast.withAction(t("toast.stampSaved", { name: stamp.name }), { label: t("stamps.use"), run: () => pickStamp(stamp.id) });
  return stamp;
}

/** Makes a library stamp the brush: one click places it with all its layers. */
export function pickStamp(id: string): void {
  const stamp = useProjectLibrary.getState().stamps.find((s) => s.id === id);
  const editor = useEditorStore.getState();
  if (!stamp || !editor.project) return;
  editor.setRandomSet([]);
  editor.setStamp(stamp);
  editor.setRegion(null);
  editor.setTool("brush");
}

/** Id of the library stamp currently on the brush (flipped or not), or null. */
export function activeStampId(stamp: unknown): string | null {
  const id = (stamp as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : null;
}

export function renameStamp(id: string, name: string): void {
  const trimmed = name.trim();
  const library = useProjectLibrary.getState();
  const stamp = library.stamps.find((s) => s.id === id);
  if (!stamp || trimmed.length === 0 || trimmed === stamp.name) return;
  library.renameStamp(id, trimmed);
  const editor = useEditorStore.getState();
  if (activeStampId(editor.stamp) === id && editor.stamp) editor.setStamp(Object.freeze({ ...editor.stamp, name: trimmed }) as Stamp);
}

/** Removes a stamp from the library (its file goes on the next save); "Geri al" in the toast restores it. */
export function deleteStamp(id: string): void {
  const removed = useProjectLibrary.getState().removeStamp(id);
  if (!removed) return;
  const editor = useEditorStore.getState();
  if (activeStampId(editor.stamp) === id) editor.setStamp(null);
  toast.withAction(t("toast.stampRemoved", { name: removed.name }), {
    label: t("common.undo"),
    run: () => {
      if (!useProjectLibrary.getState().stamps.some((s) => s.id === id)) useProjectLibrary.getState().addStamp(removed);
    },
  });
}
