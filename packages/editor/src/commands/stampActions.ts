import { cellPaletteIndex, cellFlags } from "@smap/core";
/**
 * Stamp library actions (v0.6): save the marquee as a multi-layer stamp,
 * make a stamp the brush, rename, delete. Stamps are flat copies: placing
 * one keeps no link back to the library (CLAUDE.md → Yapılmayacaklar).
 */
import { copyRegion, createStamp, isEntityLayer, makeStampId, withStampMeta, type CellRect, type MapDocument, type Stamp, type StampMeta } from "@smap/core";

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

/** Whether the selected region contains any tiles or collision cells. */
export function canSaveSelectionStamp(): boolean {
  const doc = useEditorStore.getState().project?.store.document;
  const region = stampRegion();
  return !!doc && !!region && usedStampLayerIds(doc, region).length > 0;
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
  toast.withAction(t("toast.stampSaved", { name: stamp.name }), {
    label: t("stamps.use"), run: () => pickStamp(stamp.id),
    spent: () => useEditorStore.getState().tool === "brush" && activeStampId(useEditorStore.getState().stamp) === stamp.id,
    watch: (onChange) => useEditorStore.subscribe(onChange),
  });
  return stamp;
}

/** Makes a library stamp the brush: one click places it with all its layers. */
export function pickStamp(id: string): void {
  const stamp = useProjectLibrary.getState().stamps.find((s) => s.id === id);
  const editor = useEditorStore.getState();
  if (!stamp || !editor.project) return;
  // A stamp saved with a tileset that was removed since cannot be placed.
  const doc = editor.project.store.document;
  if (stamp.palette.some((e) => !doc.getTileset(e.tilesetId))) {
    toast.error(t("tilesetLib.stampRemovedTileset", { name: stamp.name }));
    return;
  }
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

/** "Çoğalt": a copy of a library stamp under a new id and "<ad> kopya" name, right after it in the list. */
export function duplicateStamp(id: string): Stamp | null {
  const library = useProjectLibrary.getState();
  const stamp = library.stamps.find((s) => s.id === id);
  if (!stamp) return null;
  const names = new Set(library.stamps.map((s) => s.name));
  let name = t("contextMenu.stampCopyName", { name: stamp.name });
  for (let n = 2; names.has(name); n++) name = `${t("contextMenu.stampCopyName", { name: stamp.name })} ${n}`;
  const copy = Object.freeze({ ...stamp, id: makeStampId(name, takenStampIds(library)), name }) as Stamp;
  library.addStamp(copy);
  toast.success(t("toast.stampDuplicated", { name }));
  return copy;
}

/**
 * Round 5: new library metadata for a stamp (category, tags, ★). Saved with
 * the project like a rename (`stamps/<id>.json`); cells are untouched.
 * Returns the updated stamp, or null (unknown id, invalid or unchanged meta).
 */
export function setStampMeta(id: string, meta: StampMeta): Stamp | null {
  const library = useProjectLibrary.getState();
  const stamp = library.stamps.find((s) => s.id === id);
  if (!stamp) return null;
  let next: Stamp;
  try {
    next = withStampMeta(stamp, meta);
  } catch (error) {
    console.error(error);
    return null;
  }
  if (next.category === stamp.category && next.favorite === stamp.favorite && sameTags(next.tags, stamp.tags)) return null;
  library.addStamp(next);
  return next;
}

function sameTags(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((t, i) => t === y[i]);
}

/** ★ on / off. */
export function toggleStampFavorite(id: string): void {
  const stamp = useProjectLibrary.getState().stamps.find((s) => s.id === id);
  if (stamp) setStampMeta(id, { favorite: !stamp.favorite });
}

/**
 * Round 5 (stamp editor "Kaydet"): replaces a library stamp's cells with
 * `content` (id, name and metadata kept). Maps that already hold copies of
 * it do not change: stamps are flat copies. Returns the saved stamp, or null.
 */
export function replaceStampContent(id: string, content: Stamp): Stamp | null {
  const library = useProjectLibrary.getState();
  const stamp = library.stamps.find((s) => s.id === id);
  if (!stamp) return null;
  const meta: StampMeta = {
    ...(stamp.category !== undefined ? { category: stamp.category } : {}),
    ...(stamp.tags !== undefined ? { tags: stamp.tags } : {}),
    ...(stamp.favorite !== undefined ? { favorite: stamp.favorite } : {}),
  };
  const { category: _c, tags: _t, favorite: _f, nineSlice: _nine, ...rawCells } = content;
  // The temporary stamp document has fresh layer ids. Keep canonical source ids by layer order/kind.
  const sourceIds = new Set<string>();
  const layers = rawCells.layers.map((layer, i) => {
    const old = stamp.layers[i];
    const wanted = old && !!old.grid === !!layer.grid && old.role === layer.role ? old.layerId : layer.layerId;
    let layerId = wanted;
    for (let n = 2; sourceIds.has(layerId); n++) layerId = `${wanted}-${n}`;
    sourceIds.add(layerId);
    return { ...layer, layerId };
  });
  const unchanged = stamp.width === content.width && stamp.height === content.height && stamp.layers.length === layers.length && layers.every((layer, i) => {
    const old = stamp.layers[i]!;
    return layer.layerId === old.layerId && layer.cells.length === old.cells.length && [...layer.cells].every((cell, j) => {
      const prev = old.cells[j]!;
      if (layer.grid) return cell === prev;
      const a = content.palette[cellPaletteIndex(cell) - 1], b = stamp.palette[cellPaletteIndex(prev) - 1];
      return cellFlags(cell) === cellFlags(prev) && a?.tilesetId === b?.tilesetId && a?.tileId === b?.tileId;
    });
  });
  const cells = { ...rawCells, layers, ...(unchanged && stamp.nineSlice ? { nineSlice: stamp.nineSlice } : {}) };
  const next = withStampMeta(Object.freeze({ ...cells, id: stamp.id, name: stamp.name }) as Stamp, meta);
  library.addStamp(next);
  syncBrush(next);
  return next;
}

/** A brush holding `stamp` (by id) picks up its new version. */
function syncBrush(stamp: Stamp): void {
  const editor = useEditorStore.getState();
  if (activeStampId(editor.stamp) === stamp.id) editor.setStamp(stamp);
}
