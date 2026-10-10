/**
 * Palette actions on the open project (core `Collection`s, undoable
 * `setCollection` / `removeCollection` ops of the active level; several
 * changed palettes are one transaction = one undo step). Pure rules are in
 * `paletteModel.ts`.
 */
import { collectionClip, type Collection, type MapStore, type Tileset } from "@smap/core";

import { addTilesToRandom } from "../../commands/randomBrush";
import { tileLayerForPick } from "../../commands/terrainActions";
import { undoStepAction } from "../../commands/undoStepAction";
import { t } from "../../i18n";
import { useEditorStore, type ToolId } from "../../state/editorStore";
import { toast, useToastStore } from "../toast/toastStore";
import { askText } from "../tileset/TextPrompt";
import { cellOf, type Cell } from "../tileset/selectionModel";
import { useTilesetView } from "../tileset/tilesetViewStore";
import {
  clearSlots,
  DEFAULT_PALETTE_COLUMNS,
  dropOnPalette,
  itemsOfSlots,
  itemsOfTiles,
  appendItems,
  placeItems,
  setPaletteColumns,
  slotIndex,
  uniquePaletteId,
  uniquePaletteName,
  type DragSource,
  type PaletteData,
  type PaletteItem,
} from "./paletteModel";
import { usePaletteStore } from "./paletteStore";

const activeStore = (): MapStore | null => useEditorStore.getState().project?.store ?? null;
const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Palettes of the open project. */
export function palettes(): readonly Collection[] {
  return activeStore()?.document.collections ?? [];
}

function markDirty(): void {
  if (!useEditorStore.getState().dirty) useEditorStore.getState().setDirty(true);
}

/** Writes changed palettes as one undo step. */
export function applyPalettes(changed: readonly PaletteData[]): boolean {
  const store = activeStore();
  if (!store || store.inTransaction || changed.length === 0) return false;
  const before = store.revision;
  store.beginTransaction();
  try {
    for (const collection of changed) store.dispatch({ type: "setCollection", collection });
    store.commit();
  } catch (error) {
    store.rollback();
    console.error(error);
    toast.error(t("palettes.failed", { detail: describeError(error) }));
    return false;
  }
  if (store.revision !== before) markDirty();
  return true;
}

/** Shows palette `id` in the tileset dock ("Tek"); null = back to the tileset. */
export function showPalette(id: string | null): void {
  usePaletteStore.getState().setActivePalette(id);
  if (id !== null) useTilesetView.getState().requestJump(`palette:${id}`);
}

/** "+ Yeni palet": asks for a name, creates an empty palette and shows it. */
export async function createPalette(): Promise<string | null> {
  const store = activeStore();
  if (!store) return null;
  const name = await askText({
    title: t("palettes.newTitle"),
    label: t("palettes.name"),
    initial: uniquePaletteName(store.document.collections, t("palettes.defaultName")),
    confirm: t("palettes.create"),
  });
  if (!name || activeStore() !== store) return null;
  const id = uniquePaletteId(store.document.collections);
  if (!applyPalettes([{ id, name, columns: DEFAULT_PALETTE_COLUMNS, cells: [] }])) return null;
  showPalette(id);
  return id;
}

export async function renamePalette(id: string): Promise<void> {
  const palette = activeStore()?.document.getCollection(id);
  if (!palette) return;
  const name = await askText({ title: t("palettes.renameTitle"), label: t("palettes.name"), initial: palette.name, confirm: t("palettes.rename") });
  const now = activeStore()?.document.getCollection(id);
  if (!name || !now || name === now.name) return;
  applyPalettes([{ ...now, name }]);
}

/** Removes a palette (one undo step; toast with "Geri al"). Its tiles stay in their tilesets. */
export function deletePalette(id: string): boolean {
  const store = activeStore();
  const palette = store?.document.getCollection(id);
  if (!store || !palette || store.inTransaction) return false;
  try {
    store.dispatch({ type: "removeCollection", id });
  } catch (error) {
    console.error(error);
    toast.error(t("palettes.failed", { detail: describeError(error) }));
    return false;
  }
  markDirty();
  const ps = usePaletteStore.getState();
  if (ps.activePaletteId === id) ps.setActivePalette(null);
  if (ps.selection?.paletteId === id) ps.setSelection(null);
  const undo = undoStepAction(store, () => usePaletteStore.getState().setActivePalette(id));
  useToastStore.getState().push("success", t("palettes.removed", { name: palette.name }), 8000, undo);
  return true;
}

export function setPaletteColumnCount(id: string, columns: number): void {
  const palette = activeStore()?.document.getCollection(id);
  if (!palette) return;
  const next = setPaletteColumns(palette, columns);
  if (next !== palette) {
    usePaletteStore.getState().setSelection(null);
    applyPalettes([next]);
  }
}

/** Empties slots `ids` of palette `id`. */
export function clearPaletteSlots(id: string, ids: readonly number[]): void {
  const palette = activeStore()?.document.getCollection(id);
  if (!palette) return;
  const next = clearSlots(palette, ids);
  if (next === palette) return;
  const ps = usePaletteStore.getState();
  if (ps.selection?.paletteId === id) ps.setSelection(null);
  applyPalettes([next]);
}

/** Selects slots of `palette` (no brush change): after a drop / paste, the new tiles are selected. */
function selectSlots(palette: PaletteData, at: Cell, items: readonly PaletteItem[]): void {
  const ids = items.filter((it) => at.col + it.dx < palette.columns).map((it) => slotIndex(palette.columns, at.col + it.dx, at.row + it.dy));
  if (ids.length === 0) return;
  const focus = cellOf(palette, Math.max(...ids));
  usePaletteStore.getState().setSelection({ paletteId: palette.id, ids: [...ids].sort((a, b) => a - b), anchor: at, focus, clip: null });
}

/** Drops dragged tiles on palette `targetId` (at a slot, or appended); copy, or move with Shift. */
export function dropTiles(targetId: string, items: readonly PaletteItem[], slot: Cell | null, source: DragSource, move: boolean): boolean {
  const doc = activeStore()?.document;
  if (!doc) return false;
  const changed = dropOnPalette(doc.collections, targetId, items, slot ? { x: slot.col, y: slot.row } : null, source, move);
  if (changed.length === 0) return false;
  if (!applyPalettes(changed)) return false;
  const target = activeStore()?.document.getCollection(targetId);
  if (target && slot) selectSlots(target, slot, items);
  if (!slot) toast.success(t("palettes.added", { count: items.length, name: target?.name ?? "" }));
  return true;
}

// ------------------------------------------------------------------ clipboard

/** Ctrl+C in the tileset: copies the selected tiles (layout kept) for a paste into a palette. */
export function copyTilesetTiles(tileset: Tileset, ids: readonly number[], empty: ReadonlySet<number>): boolean {
  const items = itemsOfTiles(tileset.id, tileset.columns, ids, empty);
  if (items.length === 0) return false;
  usePaletteStore.getState().setClipboard(items);
  toast.info(t("palettes.copied", { count: items.length }));
  return true;
}

/** Ctrl+C in a palette. */
export function copyPaletteSlots(palette: PaletteData, ids: readonly number[]): boolean {
  const items = itemsOfSlots(palette, ids);
  if (items.length === 0) return false;
  usePaletteStore.getState().setClipboard(items);
  toast.info(t("palettes.copied", { count: items.length }));
  return true;
}

/** Ctrl+V in a palette: the copied tiles at `at` (the focused slot), or appended. */
export function pasteIntoPalette(paletteId: string, at: Cell | null): boolean {
  const items = usePaletteStore.getState().clipboard;
  const palette = activeStore()?.document.getCollection(paletteId);
  if (!palette) return false;
  if (!items || items.length === 0) {
    toast.info(t("palettes.nothingToPaste"));
    return false;
  }
  const exists = (id: string) => !!activeStore()?.document.getTileset(id);
  const usable = items.filter((it) => exists(it.tilesetId));
  if (usable.length === 0) return false;
  const next = at ? placeItems(palette, usable, at.col, at.row) : appendItems(palette, usable);
  if (!applyPalettes([next])) return false;
  const now = activeStore()?.document.getCollection(paletteId);
  if (now && at) selectSlots(now, at, usable);
  return true;
}

// ------------------------------------------------------------------ brush

const KEEPS_TOOL: readonly ToolId[] = ["brush", "fill", "rect"];

/**
 * Makes slots `ids` of `palette` the brush: one filled, unflipped slot →
 * that tile; otherwise a stamp (layout and flips kept, holes empty).
 * Ends a random brush. Returns false when no selected slot is filled.
 */
export function commitPaletteSelection(palette: Collection, ids: readonly number[], corners: { anchor: Cell; focus: Cell }): boolean {
  const s = useEditorStore.getState();
  const doc = s.project?.store.document;
  const wanted = new Set(ids);
  const picked = palette.cells.filter((c) => wanted.has(slotIndex(palette.columns, c.x, c.y)) && doc?.getTileset(c.tilesetId));
  if (picked.length === 0) {
    usePaletteStore.getState().setSelection({ paletteId: palette.id, ids: [...ids], anchor: corners.anchor, focus: corners.focus, clip: null });
    return false;
  }
  s.setRandomSet([]);
  const only = picked.length === 1 ? picked[0]! : null;
  let clip = null;
  if (only && !only.flags) {
    s.setStamp(null);
    s.setSelection({ tilesetId: only.tilesetId, tileId: only.tileId });
  } else {
    clip = collectionClip(
      palette,
      picked.map((c) => ({ x: c.x, y: c.y })),
      { layerId: s.activeLayerId ?? "tiles" },
    );
    s.setSelection({ tilesetId: picked[0]!.tilesetId, tileId: picked[0]!.tileId });
    s.setStamp(clip);
  }
  usePaletteStore.getState().setSelection({ paletteId: palette.id, ids: [...ids].sort((a, b) => a - b), anchor: corners.anchor, focus: corners.focus, clip });
  // A palette pick is not a tileset pick: the tileset highlight goes.
  useTilesetView.getState().setSelection(null);
  const target = doc ? tileLayerForPick(doc, s.activeLayerId) : null;
  if (target) s.setActiveLayer(target);
  if (!KEEPS_TOOL.includes(s.tool)) s.setTool("brush");
  return true;
}

/** Alt + drag in a palette: its filled slots in the rectangle join the random brush. */
export function addPaletteSlotsToRandom(palette: Collection, ids: readonly number[]): void {
  const wanted = new Set(ids);
  const tiles = palette.cells
    .filter((c) => wanted.has(slotIndex(palette.columns, c.x, c.y)))
    .map((c) => (c.flags ? { tilesetId: c.tilesetId, tileId: c.tileId, flags: c.flags } : { tilesetId: c.tilesetId, tileId: c.tileId }));
  addTilesToRandom(tiles);
  usePaletteStore.getState().setSelection(null);
}

/** "Palete ekle ▸ X": appends `items` to palette `id` (first free slots). */
export function addToPalette(id: string, items: readonly PaletteItem[]): boolean {
  return dropTiles(id, items, null, { kind: "tileset", tilesetId: items[0]?.tilesetId ?? "" }, false);
}

/** "Palete ekle ▸ Yeni palet…": a new palette holding `items` (layout kept). */
export async function addToNewPalette(items: readonly PaletteItem[]): Promise<void> {
  const id = await createPalette();
  const palette = id ? activeStore()?.document.getCollection(id) : undefined;
  if (!palette || items.length === 0) return;
  const width = Math.max(...items.map((i) => i.dx)) + 1;
  const sized = width > palette.columns ? setPaletteColumns(palette, width) : palette;
  applyPalettes([placeItems(sized, items, 0, 0)]);
}
