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
  type MapDocument,
  type MapStore,
  type Stamp,
  type TileGrid,
  type TileGridSpec,
  type TilesetRemapResult,
} from "@smap/core";

import { t } from "../i18n";
import { decodeTilesetFile, addTilesetFiles, createProjectFromTilesets, describeError, getLevelWorkspace, getProjectFolder, publishLevelState } from "../io/session";
import { useProjectLibrary } from "../io/projectLibrary";
import { gridKey, loadAllLevels, remapBrush, remapStamps, sameGrid, syncLevelGrids } from "../io/tilesetRegrid";
import { decodePng } from "../io/projectIo";
import { useEditorStore } from "../state/editorStore";
import { getTilesetImage, notifyTilesetImage, setTilesetImage } from "../state/tilesetImages";
import { pickFiles } from "../ui/pickFiles";
import { toast, useToastStore } from "../ui/toast/toastStore";
import { useUiStore } from "../ui/uiStore";
import { draftFromSpec } from "../ui/tilesetImport/importModel";
import { openTilesetCard } from "../ui/tilesetImport/importStore";
import { useTilesetView } from "../ui/tileset/tilesetViewStore";
import { readAlpha } from "../ui/tilesetImport/imageAlpha";
import { registerCommands, registerPaletteProvider, type Command } from "./registry";

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
    if (old) rememberImage(tilesetId, old.bytes, old.bitmap.width, old.bitmap.height);
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
  if (!tileset || !current || !list) return;
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
  /** Active store revision right after the edit (the undo button checks it). */
  revision: number;
  sync: SyncStats;
}

interface SyncStats {
  levels: number;
  clearedCells: number;
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
  let result: TilesetRemapResult;
  suspended = true;
  try {
    result = edit(store);
  } catch (error) {
    console.error(error);
    toast.error(t("tilesetImport.failed", { detail: describeError(error) }));
    return null;
  } finally {
    suspended = false;
  }
  const sync = syncProject();
  return { changed: store.revision !== before, result, store, revision: store.revision, sync };
}

function describeResult(outcome: RegridOutcome): string {
  const r = outcome.result;
  const parts: string[] = [];
  if (r.remapped > 0) parts.push(t("tilesetImport.resultRemapped", { count: r.remapped }));
  const cleared = r.clearedCells + outcome.sync.clearedCells;
  if (cleared > 0) parts.push(t("tilesetImport.resultCleared", { count: cleared }));
  if (r.outOfRange > 0) parts.push(t("tilesetImport.resultOutOfRange", { count: r.outOfRange }));
  if (r.droppedSolidTiles > 0) parts.push(t("tilesetImport.resultDroppedSolid", { count: r.droppedSolidTiles }));
  if (r.droppedTerrains.length > 0) parts.push(t("tilesetImport.resultDroppedTerrains", { count: r.droppedTerrains.length }));
  if (outcome.sync.levels > 0) parts.push(t("tilesetImport.resultLevels", { count: outcome.sync.levels }));
  if (outcome.sync.stamps > 0) parts.push(t("tilesetImport.resultStamps", { count: outcome.sync.stamps }));
  if (parts.length === 0) parts.push(t("tilesetImport.resultNothing"));
  return parts.join(", ");
}

/** Result toast with "Geri al": one undo of the active level (the rest of the project follows). */
function showResult(message: string, outcome: RegridOutcome): void {
  const lossy = outcome.result.clearedCells + outcome.sync.clearedCells > 0 || outcome.result.droppedTerrains.length > 0;
  useToastStore.getState().push(lossy ? "warning" : "success", message, 8000, {
    label: t("common.undo"),
    run: () => {
      const store = activeStore();
      if (store === outcome.store && store.revision === outcome.revision && store.canUndo) store.undo();
      else toast.info(t("tilesetImport.undoGone"));
    },
  });
}


// ------------------------------------------------------------------ sync

/** Grids the canvas atlases were last built for, per tileset. */
const seenGrids = new Map<string, TileGrid>();
/** Grids the saved stamps currently use, per tileset. */
const stampGrids = new Map<string, TileGrid>();
/** Stamp library before / after each remap, so undo / redo restore it exactly. */
let stampSnapshots: { tilesetId: string; from: string; to: string; before: readonly Stamp[]; after: readonly Stamp[] }[] = [];

const gridOf = (g: TileGrid): TileGrid => ({
  tileWidth: g.tileWidth,
  tileHeight: g.tileHeight,
  margin: g.margin,
  spacing: g.spacing,
  columns: g.columns,
  rows: g.rows,
});

/**
 * Brings the project to the active level's tileset grids: canvas atlases,
 * the tileset image (undo of a replacement), every cached level and the
 * stamps. Cheap when nothing changed.
 */
export function syncProject(): SyncStats {
  const stats: SyncStats = { levels: 0, clearedCells: 0, stamps: 0 };
  const ws = getLevelWorkspace();
  const store = activeStore();
  if (!ws || !store || suspended) return stats;
  const doc = store.document;
  const regridded: { tilesetId: string; before: TileGrid; after: TileGrid }[] = [];
  for (const tileset of doc.tilesets) {
    const seen = seenGrids.get(tileset.id);
    if (seen && !sameGrid(seen, tileset)) {
      followImage(doc, tileset.id);
      notifyTilesetImage(tileset.id);
      regridded.push({ tilesetId: tileset.id, before: seen, after: gridOf(tileset) });
    }
    seenGrids.set(tileset.id, gridOf(tileset));
  }
  const levels = syncLevelGrids(ws);
  stats.levels = levels.levels.length;
  stats.clearedCells = levels.clearedCells;
  stats.stamps = syncStamps(doc);
  // The brush, random set and recent strip name tiles by id: they follow the pixels too.
  for (const { tilesetId, before, after } of regridded) followBrush(tilesetId, before, after);
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
}

/** Remaps (or restores) the stamp library to `doc`'s grids; returns how many stamps changed. */
function syncStamps(doc: MapDocument): number {
  let changed = 0;
  for (const tileset of doc.tilesets) {
    const have = stampGrids.get(tileset.id);
    stampGrids.set(tileset.id, gridOf(tileset));
    if (!have || sameGrid(have, tileset)) continue;
    const current = useProjectLibrary.getState().stamps;
    const from = gridKey(have);
    const to = gridKey(tileset);
    const undo = stampSnapshots.find((s) => s.tilesetId === tileset.id && s.to === from && s.from === to && s.after === current);
    const redo = stampSnapshots.find((s) => s.tilesetId === tileset.id && s.from === from && s.to === to && s.before === current);
    let next: readonly Stamp[] = current;
    if (undo) next = undo.before;
    else if (redo) next = redo.after;
    else {
      const remapped = remapStamps(current, tileset.id, have, tileset);
      if (remapped.changed.length > 0) {
        next = remapped.stamps;
        stampSnapshots.push({ tilesetId: tileset.id, from, to, before: current, after: next });
        if (stampSnapshots.length > 32) stampSnapshots = stampSnapshots.slice(-32);
      }
    }
    if (next === current) continue;
    changed += next.filter((s, i) => s !== current[i]).length || 1;
    useProjectLibrary.setState((s) => ({ stamps: [...next], revision: s.revision + 1 }));
    // The library keeps its own array; remember that identity for the next undo / redo.
    const stored = useProjectLibrary.getState().stamps;
    for (const snap of stampSnapshots) {
      if (snap.before === next) snap.before = stored;
      if (snap.after === next) snap.after = stored;
    }
  }
  return changed;
}

/** Forgets per-project state (a project was opened or closed). */
function resetSync(): void {
  seenGrids.clear();
  stampGrids.clear();
  stampSnapshots = [];
  imageVersions.clear();
  const doc = activeStore()?.document;
  if (!doc) return;
  for (const tileset of doc.tilesets) {
    seenGrids.set(tileset.id, gridOf(tileset));
    stampGrids.set(tileset.id, gridOf(tileset));
  }
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
    if (tilesets.length < 2) return [];
    return tilesets.map((ts) => ({
      key: `tileset.settings:${ts.id}`,
      prefix: t("commands.tileset.settings"),
      title: ts.name,
      run: () => void openTilesetSettings(ts.id),
    }));
  });

  let workspace = getLevelWorkspace();
  let unsubscribeStore: (() => void) | null = null;
  const watch = (store: MapStore | null) => {
    unsubscribeStore?.();
    unsubscribeStore = store
      ? store.subscribe((event) => {
          if (event.structure.includes("tilesets")) syncProject();
        })
      : null;
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
