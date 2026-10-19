import { isGeneratedAsset } from "@smap/core";
/**
 * Tileset actions: the import card from every entry point, the settings
 * card ("Tileset ayarları…"), replacing the image, and keeping the whole
 * project consistent after a grid edit.
 *
 * Grid edits are project-wide: core remaps only the open level, so after
 * every tileset change of the active level (the edit itself, and Ctrl+Z /
 * Ctrl+Y of it) {@link syncProject} brings every other level
 * (`syncLevelGrids`), the saved stamps and the tileset image to the same
 * grid. One undo step in the active level therefore undoes the edit
 * everywhere.
 *
 * Panels call {@link openTilesetSettings} / {@link openTilesetImport} /
 * {@link replaceTilesetImage}; the command palette has the same commands.
 */
import {
  gridCount,
  inferTileGrid,
  tilesetUsage,
  type MapDocument,
  type MapStore,
  type TileGrid,
  type TileGridSpec,
  type TilesetRemapResult,
} from "@smap/core";

import { t } from "../i18n";
import { decodeTilesetFile, addTilesetFiles, createProjectFromTilesets, describeError, getLevelWorkspace, getProjectFolder, publishLevelState } from "../io/session";
import { affectedTilesetStamps } from "../io/smartStampRecipes";
import { useProjectLibrary } from "../io/projectLibrary";
import {
  dropTileRefs,
  dropTilesetRefs,
  gridCopy,
  loadAllLevels,
  recordListChange,
  recordRegrid,
  remapBrush,
  remapTileRefs,
  sameGrid,
  syncLevelGrids,
  syncLevelLists,
  syncStampGrid,
  tilesetListKey,
  type StampRegrid,
} from "../io/tilesetRegrid";
import { decodePng } from "../io/projectIo";
import { useEditorStore } from "../state/editorStore";
import { getTilesetImage, notifyTilesetImage, setTilesetImage } from "../state/tilesetImages";
import { pickFiles } from "../ui/pickFiles";
import { toast, useToastStore, type ToastAction } from "../ui/toast/toastStore";
import { useUiStore } from "../ui/uiStore";
import { draftFromSpec } from "../ui/tilesetImport/importModel";
import { openTilesetCard } from "../ui/tilesetImport/importStore";
import { useTilesetView } from "../ui/tileset/tilesetViewStore";
import { showDockTab } from "../ui/layout/dock/dockActions";
import { usePaletteStore } from "../ui/palettes/paletteStore";
import { readAlpha } from "../ui/tilesetImport/imageAlpha";
import { groupNames, planTilesetMove, summarizeUsage, uniqueGroupName, type DropTarget, type LevelUsage } from "../ui/tileset/libraryModel";
import { askRemoveTileset } from "../ui/tileset/RemoveTilesetDialog";
import { askText } from "../ui/tileset/TextPrompt";
import { registerCommands, registerPaletteProvider, type Command } from "./registry";
import { dropMemoryClipUnless } from "./clipboard";
import { undoStepAction } from "./undoStepAction";

const activeStore = (): MapStore | null => useEditorStore.getState().project?.store ?? null;

/** The tileset the panels show, else the first one. */
function currentTilesetId(): string | null {
  const doc = activeStore()?.document;
  if (!doc) return null;
  const id = useUiStore.getState().activeTilesetId;
  return (id && doc.getTileset(id) ? id : doc.tilesets[0]?.id) ?? null;
}

// ------------------------------------------------------------------ import

/**
 * "Tileset ekle…": file picker → the import card per file. Without a
 * project the first PNG starts one (like the welcome drop).
 */
export async function openTilesetImport(): Promise<void> {
  const files = await pickFiles("image/png");
  if (files.length === 0) return;
  await importTilesetFiles(files);
}

/** PNG files from any entry point (drop, picker, paste) → the import card. */
export function importTilesetFiles(files: readonly File[]): Promise<void> {
  return useEditorStore.getState().project ? addTilesetFiles(files) : createProjectFromTilesets(files);
}

// ------------------------------------------------------------------ settings

/**
 * Opens the settings card of a tileset (tile size, margin, spacing) and
 * applies the change to the whole project. For panels: tileset tab /
 * dropdown context menu, "Tileset ayarları…".
 */
export async function openTilesetSettings(tilesetId: string | null = currentTilesetId()): Promise<void> {
  const store = activeStore();
  const tileset = tilesetId ? store?.document.getTileset(tilesetId) : undefined;
  if (!store || !tileset) return;
  if (isGeneratedAsset(tileset)) { toast.info(t(tileset.edited ? "pixel.fixedAsset" : "smartStamp.fixedGrid")); return; }
  const image = getTilesetImage(tileset.id);
  if (!image) {
    toast.error(t("toast.missingTilesetImage", { path: tileset.imagePath }));
    return;
  }
  const { width, height } = image.bitmap;
  const alpha = readAlpha(image.bitmap);
  const { suggestions } = inferTileGrid({
    width,
    height,
    fileName: tileset.imagePath,
    hintSize: tileset.tileWidth,
    ...(alpha ? { alpha } : {}),
  });
  const map = store.document.map;
  const result = await openTilesetCard({
    mode: { kind: "edit", tilesetId: tileset.id },
    fileName: tileset.imagePath,
    bitmap: image.bitmap,
    width,
    height,
    alpha,
    initial: draftFromSpec(tileset.name, tileset),
    suggestions,
    mapTile: { tileWidth: map.tileWidth, tileHeight: map.tileHeight },
  });
  if (!result) return;
  if (result.kind === "replaceImage") {
    await replaceTilesetImage(tileset.id);
    return;
  }
  await applyTilesetGrid(tileset.id, result.spec);
}

/**
 * Re-slices a tileset with `spec` in every level and stamp (see the module
 * doc). Shows the result with an undo button. Returns false when nothing
 * was applied.
 */
export async function applyTilesetGrid(tilesetId: string, spec: TileGridSpec): Promise<boolean> {
  const fixed = activeStore()?.document.getTileset(tilesetId);
  if (fixed && isGeneratedAsset(fixed)) { toast.info(t(fixed.edited ? "pixel.fixedAsset" : "smartStamp.fixedGrid")); return false; }
  const image = getTilesetImage(tilesetId);
  return runProjectRegrid(tilesetId, (store) =>
    store.dispatch({
      type: "updateTilesetGrid",
      tilesetId,
      ...spec,
      ...(image ? { imageWidth: image.bitmap.width, imageHeight: image.bitmap.height } : {}),
    }),
  ).then((outcome) => {
    if (!outcome) return false;
    if (!outcome.changed) {
      toast.info(t("tilesetImport.unchanged"));
      return false;
    }
    showResult(t("tilesetImport.gridUpdated", { detail: describeResult(outcome) }), outcome);
    return true;
  });
}

// ------------------------------------------------------------------ replace image

/** Earlier images of a tileset, so that undoing an image replacement shows the old pixels again. */
const imageVersions = new Map<string, { bytes: Uint8Array; width: number; height: number }[]>();

/**
 * "Görseli değiştir…": picks a PNG and makes it the tileset's image. Tiles
 * keep their pixel position (`replaceTilesetImage`); every level and stamp
 * follows. Undo brings the old image back.
 */
export async function replaceTilesetImage(tilesetId: string | null = currentTilesetId()): Promise<boolean> {
  if (!tilesetId || !activeStore()?.document.getTileset(tilesetId)) return false;
  const fixed = activeStore()?.document.getTileset(tilesetId);
  if (fixed && isGeneratedAsset(fixed)) { toast.info(t(fixed.edited ? "pixel.fixedAsset" : "smartStamp.fixedGrid")); return false; }
  const [file] = await pickFiles("image/png", false);
  if (!file) return false;
  const png = await decodeTilesetFile(file);
  if (!png) return false;
  const old = getTilesetImage(tilesetId);
  const { width, height } = png.bitmap;
  let swapped = false;
  const outcome = await runProjectRegrid(tilesetId, (store) => {
    const result = store.dispatch({ type: "replaceTilesetImage", tilesetId, imageWidth: width, imageHeight: height });
    // The new pixels go in right away (same grid, other image), before the levels follow.
    if (old?.bytes) rememberImage(tilesetId, old.bytes, old.bitmap.width, old.bitmap.height);
    setTilesetImage({ tilesetId, bitmap: png.bitmap, bytes: png.bytes });
    swapped = true;
    return result;
  });
  if (!swapped) png.bitmap.close();
  if (!outcome) return false;
  if (!useEditorStore.getState().dirty) useEditorStore.getState().setDirty(true);
  if (!outcome.changed) {
    toast.success(t("tilesetImport.imageSame"));
    return true;
  }
  showResult(t("tilesetImport.imageReplaced", { detail: describeResult(outcome) }), outcome);
  return true;
}

function rememberImage(tilesetId: string, bytes: Uint8Array, width: number, height: number): void {
  const list = imageVersions.get(tilesetId) ?? [];
  list.push({ bytes, width, height });
  if (list.length > 8) list.shift();
  imageVersions.set(tilesetId, list);
}

/** After undo / redo of an image replacement: the remembered image whose size fits the grid again. */
function followImage(doc: MapDocument, tilesetId: string): void {
  const tileset = doc.getTileset(tilesetId);
  const current = getTilesetImage(tilesetId);
  const list = imageVersions.get(tilesetId);
  if (!tileset || !current?.bytes || !list) return;
  const fits = (w: number, h: number) =>
    gridCount(w, tileset.tileWidth, tileset.margin, tileset.spacing) === tileset.columns &&
    gridCount(h, tileset.tileHeight, tileset.margin, tileset.spacing) === tileset.rows;
  if (fits(current.bitmap.width, current.bitmap.height)) return;
  let index = list.length - 1;
  while (index >= 0 && !fits(list[index]!.width, list[index]!.height)) index--;
  if (index < 0) return;
  const [version] = list.splice(index, 1);
  list.push({ bytes: current.bytes, width: current.bitmap.width, height: current.bitmap.height });
  void decodePng(version!.bytes)
    .then((bitmap) => {
      if (getTilesetImage(tilesetId) === current) setTilesetImage({ tilesetId, bitmap, bytes: version!.bytes });
      else bitmap.close();
    })
    .catch((error: unknown) => console.warn("Tileset image restore failed", error));
}

// ------------------------------------------------------------------ project-wide regrid

interface RegridOutcome {
  changed: boolean;
  result: TilesetRemapResult;
  store: MapStore;
  /** "Geri al" for the edit's own history step (checked by its stable id). */
  undo: ToastAction;
  sync: SyncStats;
}

interface SyncStats {
  levels: number;
  clearedCells: number;
  /** Cells painted again since the edit that its undo left alone (other levels). */
  keptCells: number;
  stamps: number;
}

let suspended = false;

/**
 * Loads every level (so each can follow), runs `edit` on the active level,
 * then syncs the rest of the project. `null` when it could not run.
 */
async function runProjectRegrid(tilesetId: string, edit: (store: MapStore) => TilesetRemapResult): Promise<RegridOutcome | null> {
  const ws = getLevelWorkspace();
  const store = activeStore();
  if (!ws || !store || store.inTransaction) return null;
  const failed = await loadAllLevels(ws, getProjectFolder()?.fs ?? null);
  if (failed.length > 0) {
    toast.error(t("tilesetImport.levelsUnreadable", { names: failed.join(", ") }));
    return null;
  }
  // The user may have switched level or project while files were read.
  if (getLevelWorkspace() !== ws || activeStore() !== store || !store.document.getTileset(tilesetId)) return null;
  const before = store.revision;
  const grid = gridCopy(store.document.getTileset(tilesetId)!);
  let result!: TilesetRemapResult;
  let sync!: SyncStats;
  suspended = true;
  try {
    ws.history.compound(ws.activeId, () => {
      result = edit(store);
      if (store.revision !== before) recordRegrid(store, tilesetId, grid);
      suspended = false;
      sync = syncProject();
    });
  } catch (error) {
    console.error(error);
    toast.error(t("tilesetImport.failed", { detail: describeError(error) }));
    return null;
  } finally {
    suspended = false;
  }
  const undo = undoStepAction(store, undefined, () => activeStore() === store);
  return { changed: store.revision !== before, result, store, undo, sync };
}

function describeResult(outcome: RegridOutcome): string {
  const r = outcome.result;
  const parts: string[] = [];
  if (r.remapped > 0) parts.push(t("tilesetImport.resultRemapped", { count: r.remapped }));
  const cleared = r.clearedCells + outcome.sync.clearedCells;
  if (cleared > 0) parts.push(t("tilesetImport.resultCleared", { count: cleared }));
  if (r.outOfRange > 0) parts.push(t("tilesetImport.resultOutOfRange", { count: r.outOfRange }));
  if (outcome.sync.levels > 0) parts.push(t("tilesetImport.resultLevels", { count: outcome.sync.levels }));
  if (outcome.sync.stamps > 0) parts.push(t("tilesetImport.resultStamps", { count: outcome.sync.stamps }));
  if (parts.length === 0) parts.push(t("tilesetImport.resultNothing"));
  return parts.join(", ");
}

/** Result toast with "Geri al": one undo of the active level (the rest of the project follows). */
function showResult(message: string, outcome: RegridOutcome): void {
  const lossy = outcome.result.clearedCells + outcome.sync.clearedCells > 0;
  useToastStore.getState().push(lossy ? "warning" : "success", message, 8000, outcome.undo);
}

// ------------------------------------------------------------------ sync

/** Grids the canvas atlases were last built for, per tileset. */
const seenGrids = new Map<string, TileGrid>();
/** Grids the saved stamps currently use, per tileset. */
const stampGrids = new Map<string, TileGrid>();
/** What each grid change did to the stamps (per stamp before / after), so undo / redo restore them exactly. */
let stampRecords: StampRegrid[] = [];
const MAX_STAMP_RECORDS = 32;

/**
 * Brings the project to the active level's tileset grids: canvas atlases,
 * the tileset image (undo of a replacement), every cached level and the
 * stamps. Cheap when nothing changed.
 */
export function syncProject(): SyncStats {
  const stats: SyncStats = { levels: 0, clearedCells: 0, keptCells: 0, stamps: 0 };
  const ws = getLevelWorkspace();
  const store = activeStore();
  if (!ws || !store || suspended || ws.history.applyingPlan) return stats;
  const doc = store.document;
  const regridded: { tilesetId: string; before: TileGrid; after: TileGrid }[] = [];
  for (const tileset of doc.tilesets) {
    const seen = seenGrids.get(tileset.id);
    if (seen && !sameGrid(seen, tileset)) {
      followImage(doc, tileset.id);
      notifyTilesetImage(tileset.id);
      regridded.push({ tilesetId: tileset.id, before: seen, after: gridCopy(tileset) });
    }
    seenGrids.set(tileset.id, gridCopy(tileset));
  }
  const lists = ws.history.replaying ? { levels: [] } : syncLevelLists(ws);
  const levels = ws.history.replaying ? { levels: [], clearedCells: 0, keptCells: 0 } : syncLevelGrids(ws);
  stats.levels = new Set([...lists.levels, ...levels.levels]).size;
  stats.clearedCells = levels.clearedCells;
  const stamps = syncStamps(doc);
  stats.stamps = stamps.changed;
  stats.keptCells = levels.keptCells;
  // An undo / redo of a grid edit restores the other levels and stamps exactly, except what was edited since.
  if (levels.keptCells > 0 || stamps.kept > 0) {
    toast.info(t("tilesetImport.keptEdited", { cells: levels.keptCells, stamps: stamps.kept }));
  }
  // The brush, random set and recent strip name tiles by id: they follow the pixels too.
  for (const { tilesetId, before, after } of regridded) followBrush(tilesetId, before, after);
  dropMissingTilesets(doc);
  if (stats.levels > 0) {
    publishLevelState();
    if (!useEditorStore.getState().dirty) useEditorStore.getState().setDirty(true);
  }
  return stats;
}

/** Moves the editor's brush state (and the tileset panel selection) of `tilesetId` to the new grid. */
function followBrush(tilesetId: string, before: TileGrid, after: TileGrid): void {
  const editor = useEditorStore.getState();
  const changes = remapBrush(editor, tilesetId, before, after, useProjectLibrary.getState().stamps);
  if (Object.keys(changes).length > 0) useEditorStore.setState(changes as Partial<typeof editor>);
  const view = useTilesetView.getState();
  if (view.selection?.tilesetId === tilesetId) view.setSelection(null);
  // Copied tiles waiting for a paste into a palette follow too (the palettes themselves are remapped by core).
  const palettes = usePaletteStore.getState();
  if (palettes.clipboard) {
    const next = remapTileRefs(palettes.clipboard, tilesetId, before, after);
    if (next !== palettes.clipboard) palettes.setClipboard(next.length > 0 ? next : null);
  }
  if (palettes.selection?.clip) palettes.setSelection(null);
}

/** Clears the brush, panel selection and active tileset of tilesets the active level no longer has (removed, or an add undone). */
function dropMissingTilesets(doc: MapDocument): void {
  const exists = (id: string) => doc.getTileset(id) !== undefined;
  const editor = useEditorStore.getState();
  dropMemoryClipUnless(exists);
  const changes = dropTilesetRefs(editor, exists);
  if (Object.keys(changes).length > 0) useEditorStore.setState(changes as Partial<typeof editor>);
  const view = useTilesetView.getState();
  if (view.selection && !exists(view.selection.tilesetId)) view.setSelection(null);
  const palettes = usePaletteStore.getState();
  if (palettes.clipboard) {
    const next = dropTileRefs(palettes.clipboard, exists);
    if (next !== palettes.clipboard) palettes.setClipboard(next.length > 0 ? next : null);
  }
  if (palettes.activePaletteId !== null && !doc.getCollection(palettes.activePaletteId)) palettes.setActivePalette(null);
  const ui = useUiStore.getState();
  if (ui.activeTilesetId !== null && !exists(ui.activeTilesetId)) ui.setActiveTileset(doc.tilesets[0]?.id ?? null);
}

/** Remaps (or restores) the stamp library to `doc`'s grids; how many stamps changed, and how many edited ones were remapped instead of restored. */
function syncStamps(doc: MapDocument): { changed: number; kept: number } {
  const out = { changed: 0, kept: 0 };
  for (const tileset of doc.tilesets) {
    const have = stampGrids.get(tileset.id);
    stampGrids.set(tileset.id, gridCopy(tileset));
    if (!have || sameGrid(have, tileset)) continue;
    const current = useProjectLibrary.getState().stamps;
    const r = syncStampGrid(current, tileset.id, have, tileset, stampRecords);
    out.kept += r.kept;
    if (!r.record) continue;
    stampRecords.push(r.record);
    if (stampRecords.length > MAX_STAMP_RECORDS) stampRecords = stampRecords.slice(-MAX_STAMP_RECORDS);
    out.changed += r.changed;
    useProjectLibrary.setState((s) => ({ stamps: r.stamps, revision: s.revision + 1 }));
  }
  return out;
}

/** Forgets per-project state (a project was opened or closed). */
function resetSync(): void {
  seenGrids.clear();
  stampGrids.clear();
  stampRecords = [];
  imageVersions.clear();
  const doc = activeStore()?.document;
  if (!doc) return;
  for (const tileset of doc.tilesets) {
    seenGrids.set(tileset.id, gridCopy(tileset));
    stampGrids.set(tileset.id, gridCopy(tileset));
  }
}

/**
 * Follows the active level's tileset changes: records list edits (so the
 * other levels can mirror their undo exactly) and syncs the project once
 * per step — after the transaction, not for every op inside it.
 */
function watchTilesets(store: MapStore): () => void {
  let key = tilesetListKey(store.document.tilesets);
  let pending = false;
  return store.subscribe((event) => {
    if (store.inTransaction) {
      if (event.structure.includes("tilesets")) pending = true;
      return;
    }
    if (!event.structure.includes("tilesets") && !(pending && (event.cause === "commit" || event.cause === "rollback"))) return;
    pending = false;
    // A new step (not undo / redo of an old one): remember what it did to the list.
    if (event.cause === "dispatch" || event.cause === "commit") recordListChange(store, key);
    key = tilesetListKey(store.document.tilesets);
    const ws = getLevelWorkspace();
    if (ws && ws.active.store === store) ws.history.includeFollowers(ws.activeId, syncProject);
    else syncProject();
  });
}

// ------------------------------------------------------------------ library: name, group, order, remove

/** Runs `edit` on the active level as one undo step (the other levels follow via the store subscription). */
function listStep(edit: (store: MapStore) => void): boolean {
  const store = activeStore();
  if (!store || store.inTransaction) return false;
  const before = store.revision;
  const ws = getLevelWorkspace();
  const apply = () => {
    store.beginTransaction();
    try { edit(store); store.commit(); }
    catch (error) { if (store.inTransaction) store.rollback(); throw error; }
  };
  try {
    if (ws && ws.active.store === store) ws.history.compound(ws.activeId, apply);
    else apply();
  } catch (error) {
    console.error(error);
    toast.error(t("tilesetImport.failed", { detail: describeError(error) }));
    return false;
  }
  return store.revision !== before;
}

/** Renames a tileset (all levels; undoable). */
export function renameTileset(tilesetId: string, name: string): void {
  const trimmed = name.trim();
  const tileset = activeStore()?.document.getTileset(tilesetId);
  if (!tileset || trimmed === "" || trimmed === tileset.name) return;
  listStep((store) => store.dispatch({ type: "setTilesetMeta", tilesetId, name: trimmed }));
}

/** Moves a tileset into `group` (null = ungrouped), at the group's end. */
export function setTilesetGroup(tilesetId: string, group: string | null): void {
  const doc = activeStore()?.document;
  if (!doc) return;
  const plan = planTilesetMove(doc.tilesets, tilesetId, { group: group ?? "", beforeId: null });
  if (plan) applyMove(tilesetId, plan);
}

/** Drag and drop in the library: reorder and / or regroup (one undo step). */
export function dropTileset(tilesetId: string, target: DropTarget): void {
  const doc = activeStore()?.document;
  if (!doc) return;
  const plan = planTilesetMove(doc.tilesets, tilesetId, target);
  if (plan) applyMove(tilesetId, plan);
}

function applyMove(tilesetId: string, plan: { index: number; group: string | null | undefined }): void {
  listStep((store) => {
    if (plan.group !== undefined) store.dispatch({ type: "setTilesetMeta", tilesetId, group: plan.group });
    if (store.document.tilesets.findIndex((ts) => ts.id === tilesetId) !== plan.index) {
      store.dispatch({ type: "moveTileset", tilesetId, index: plan.index });
    }
  });
}

/** "Gruba taşı ▸ Yeni grup…": asks for a name, then moves the tileset there. */
export async function moveTilesetToNewGroup(tilesetId: string): Promise<void> {
  const doc = activeStore()?.document;
  if (!doc?.getTileset(tilesetId)) return;
  const name = await askText({
    title: t("tilesetLib.newGroupTitle"),
    label: t("tilesetLib.groupName"),
    initial: uniqueGroupName(doc.tilesets, t("tilesetLib.newGroupName")),
    confirm: t("tilesetLib.newGroupConfirm"),
  });
  if (name) setTilesetGroup(tilesetId, name);
}

/** Renames a group (every tileset in it; one undo step). An existing name merges the two. */
export function renameTilesetGroup(from: string, to: string): void {
  const name = to.trim();
  const doc = activeStore()?.document;
  if (!doc || name === "" || name === from) return;
  listStep((store) => {
    for (const ts of doc.tilesets.filter((x) => (x.group ?? "") === from)) store.dispatch({ type: "setTilesetMeta", tilesetId: ts.id, group: name });
  });
}

/** Group names in use (for menus). */
export function tilesetGroups(): string[] {
  return groupNames(activeStore()?.document.tilesets ?? []);
}

/** Shows a tileset in the library: its tab, made active, scrolled to in "Tümü". */
export function gotoTileset(tilesetId: string): void {
  if (!activeStore()?.document.getTileset(tilesetId)) return;
  const ui = useUiStore.getState();
  showDockTab("tileset");
  ui.setActiveTileset(tilesetId);
  useTilesetView.getState().requestJump(tilesetId);
}

/**
 * "Kaldır": an unused tileset goes right away (toast with "Geri al"); a
 * painted one asks first, with its usage over every level. Either way it
 * is one undo step in the active level, mirrored in every other level
 * (their cells come back exactly on undo).
 */
export async function removeTileset(tilesetId: string | null = currentTilesetId()): Promise<boolean> {
  const ws = getLevelWorkspace();
  const store = activeStore();
  const tileset = tilesetId ? store?.document.getTileset(tilesetId) : undefined;
  if (!ws || !store || !tileset || store.inTransaction) return false;
  // Every level must be in memory: their cells are cleared too, and one read later would name a missing tileset.
  const failed = await loadAllLevels(ws, getProjectFolder()?.fs ?? null);
  if (failed.length > 0) {
    toast.error(t("tilesetLib.levelsUnreadable", { names: failed.join(", ") }));
    return false;
  }
  if (getLevelWorkspace() !== ws || activeStore() !== store || !store.document.getTileset(tileset.id)) return false;
  const perLevel: LevelUsage[] = ws.cachedIds().map((id) => tilesetUsage(ws.entry(id)!.store.document, tileset.id));
  const library = useProjectLibrary.getState();
  const affected = affectedTilesetStamps(tileset.id, library.stamps, library.generatedRecipes, store.document.tilesets);
  const usage = summarizeUsage(perLevel, affected.filter(id => library.stamps.some(s => s.id === id)).length);
  if (usage.used && !(await askRemoveTileset({ name: tileset.name, usage }))) return false;
  if (activeStore() !== store || !store.document.getTileset(tileset.id) || store.inTransaction) return false;
  const index = store.document.tilesets.findIndex((ts) => ts.id === tileset.id);
  try {
    store.dispatch({ type: "removeTileset", tilesetId: tileset.id });
  } catch (error) {
    console.error(error);
    toast.error(t("tilesetImport.failed", { detail: describeError(error) }));
    return false;
  }
  const next = store.document.tilesets[Math.min(index, store.document.tilesets.length - 1)];
  useUiStore.getState().setActiveTileset(next?.id ?? null);
  const undo = undoStepAction(store, () => useUiStore.getState().setActiveTileset(tileset.id), () => activeStore() === store);
  useToastStore.getState().push(usage.used ? "warning" : "success", t("tilesetLib.removed", { name: tileset.name }), 8000, undo);
  if (!useEditorStore.getState().dirty) useEditorStore.getState().setDirty(true);
  return true;
}

// ------------------------------------------------------------------ commands

const hasTileset = () => (activeStore()?.document.tilesets.length ?? 0) > 0;

const COMMANDS: Command[] = [
  {
    id: "tileset.settings",
    title: "commands.tileset.settings",
    category: "tileset",
    enabled: hasTileset,
    run: () => void openTilesetSettings(),
  },
  {
    id: "tileset.replaceImage",
    title: "commands.tileset.replaceImage",
    category: "tileset",
    enabled: hasTileset,
    run: () => void replaceTilesetImage(),
  },
  {
    id: "tileset.remove",
    title: "commands.tileset.remove",
    category: "tileset",
    enabled: hasTileset,
    run: () => void removeTileset(),
  },
  {
    // The palette lists "Tileset'e git: X" for each tileset; the command itself opens the library search.
    id: "tileset.goto",
    title: "commands.tileset.goto",
    category: "tileset",
    enabled: hasTileset,
    run: () => {
      showDockTab("tileset");
      useTilesetView.getState().setView("all");
      useTilesetView.getState().requestSearchFocus();
    },
  },
];

/**
 * Registers the tileset commands and keeps the project in sync with the
 * active level's tileset grids. Call once at startup; returns a cleanup.
 */
export function installTilesetActions(): () => void {
  registerCommands(COMMANDS);
  // With several tilesets: "Tileset ayarları: Zindan" for each.
  const unregisterPalette = registerPaletteProvider(() => {
    const tilesets = activeStore()?.document.tilesets ?? [];
    const goto = tilesets.map((ts) => ({
      key: `tileset.goto:${ts.id}`,
      prefix: t("tilesetLib.gotoPrefix"),
      title: ts.group ? `${ts.name} · ${ts.group}` : ts.name,
      run: () => gotoTileset(ts.id),
    }));
    if (tilesets.length < 2) return goto;
    return [
      ...goto,
      ...tilesets.map((ts) => ({
        key: `tileset.settings:${ts.id}`,
        prefix: t("commands.tileset.settings"),
        title: ts.name,
        run: () => void openTilesetSettings(ts.id),
      })),
    ];
  });

  let workspace = getLevelWorkspace();
  let unsubscribeStore: (() => void) | null = null;
  const watch = (store: MapStore | null) => {
    unsubscribeStore?.();
    unsubscribeStore = store ? watchTilesets(store) : null;
  };
  resetSync();
  watch(activeStore());
  const unsubscribeEditor = useEditorStore.subscribe((state, prev) => {
    if (state.project?.store === prev.project?.store) return;
    if (getLevelWorkspace() !== workspace) {
      workspace = getLevelWorkspace();
      resetSync();
    } else {
      syncProject();
    }
    watch(state.project?.store ?? null);
  });
  return () => {
    unregisterPalette();
    unsubscribeEditor();
    unsubscribeStore?.();
  };
}
