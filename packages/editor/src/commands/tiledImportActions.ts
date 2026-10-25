/**
 * Dosya → İçe aktar → Tiled haritası… (v2.2): the picked Tiled map becomes a
 * new map at the end of the current world, like "Yeni harita" (no undo step;
 * remove the map to take it back). Its tileset PNGs are copied into the world
 * as new tilesets (identical sheets reuse the existing tileset); the user's
 * files are only read. What could not be imported is listed afterwards.
 */
import { makeCell, TiledImportError, type MapStore, type PaletteEntry, type TiledUnsupported } from "@smap/core";
import { create } from "zustand";
import { manualEditAllowed } from "../agent/editGate";
import { t } from "../i18n";
import { describeError, getLevelWorkspace, getProjectFolder, openLevel, publishLevelState, sourceIdsOnDisk } from "../io/session";
import { buildTiledContent, closeTiled, loadTiled, newTiledImages, planTiledTilesets, TiledReadError, tiledErrorDetail, type LoadedTiled, type TiledContentLayer, type TiledReader } from "../io/tiledImport";
import { getPlatform } from "../platform";
import { useEditorStore } from "../state/editorStore";
import { allTilesetImages, getTilesetImage, setTilesetImage } from "../state/tilesetImages";
import { toast } from "../ui/toast/toastStore";
import { pickFiles } from "../ui/pickFiles";

export interface TiledImportReport { readonly name: string; readonly layers: number; readonly tilesets: number; readonly unsupported: readonly TiledUnsupported[] }
/** The last import's "not imported" list, shown in a dialog until closed. */
export const useTiledImportReport = create<{ report: TiledImportReport | null }>()(() => ({ report: null }));
export const closeTiledImportReport = () => useTiledImportReport.setState({ report: null });

const MAP_EXTENSIONS = ["tmx", "tmj", "json"];
const ACCEPT = ".tmx,.tmj,.json,.tsx,.tsj,.png";

/** Browser: the map and its files are picked together; references resolve by file name. */
async function pickInBrowser(): Promise<{ path: string; read: TiledReader } | null> {
  const files = await pickFiles(ACCEPT, true);
  if (files.length === 0) return null;
  const byName = new Map(files.map(f => [f.name.toLowerCase(), f]));
  const maps = files.filter(f => /\.(tmx|tmj)$/i.test(f.name));
  const map = maps[0] ?? files.find(f => /\.json$/i.test(f.name));
  if (!map) { toast.error(t("tiledImport.noMap")); return null; }
  const read: TiledReader = async (path) => {
    const file = byName.get((path.split("/").at(-1) ?? path).toLowerCase());
    if (!file) throw new Error("not found");
    return new Uint8Array(await file.arrayBuffer());
  };
  return { path: map.name, read };
}

/** Lays out one imported map: palette, cells, then locks (locked layers ignore writes). */
export function writeTiledLayers(store: MapStore, layers: readonly TiledContentLayer[], layerIds: readonly string[]): void {
  const keys = new Map<string, number>(), entries: PaletteEntry[] = [];
  for (const l of layers) for (const c of l.cells) {
    const key = `${c.tilesetId}\u0000${c.tileId}`;
    if (!keys.has(key)) { keys.set(key, entries.length); entries.push({ tilesetId: c.tilesetId, tileId: c.tileId }); }
  }
  const indices = store.dispatch({ type: "addPaletteEntries", entries });
  layers.forEach((l, i) => {
    const layerId = layerIds[i]!;
    if (l.cells.length) store.dispatch({ type: "paintCells", layerId, cells: l.cells.map(c => ({ x: c.x, y: c.y, cell: makeCell(indices[keys.get(`${c.tilesetId}\u0000${c.tileId}`)!]!, c.flags) })) });
    if (l.locked) store.dispatch({ type: "setLayerProps", layerId, props: { locked: true } });
  });
}

const IMPORT_ERRORS = {
  format: "tiledImport.error.format", orientation: "tiledImport.error.orientation", compression: "tiledImport.error.compression",
  encoding: "tiledImport.error.encoding", size: "tiledImport.error.size", noTileLayers: "tiledImport.error.noTileLayers",
} as const;

/** Localised reason for a failed import. */
export function tiledFailureText(error: unknown): string {
  if (error instanceof TiledImportError) return t(IMPORT_ERRORS[error.code]);
  if (error instanceof TiledReadError) return describeError(new Error(error.detail));
  return describeError(error);
}

/** Imports the Tiled map at `path` into the open world. Resolves true when the new map was opened. */
export async function importTiledMap(path: string, read: TiledReader): Promise<boolean> {
  if (!manualEditAllowed() || !getLevelWorkspace()) return false;
  let loaded: LoadedTiled;
  try { loaded = await loadTiled(path, read); }
  catch (error) {
    console.error(error);
    toast.error(t("tiledImport.failed", { detail: tiledFailureText(error) }));
    return false;
  }
  try {
    const ws = getLevelWorkspace();
    const project = useEditorStore.getState().project;
    if (!ws || !project || !manualEditAllowed()) { closeTiled(loaded); return false; }
    const reserved = await sourceIdsOnDisk(getProjectFolder()?.fs ?? null);
    const files = (await getProjectFolder()?.fs.list("levels").catch(() => [] as string[])) ?? [];
    if (ws !== getLevelWorkspace() || !manualEditAllowed()) { closeTiled(loaded); return false; }
    const active = ws.active.store;
    const taken = new Set<string>([...active.document.tilesets.map(ts => ts.id), ...reserved]);
    for (const image of allTilesetImages()) taken.add(image.tilesetId);
    const plans = planTiledTilesets(loaded, active.document.tilesets, id => getTilesetImage(id)?.bytes, taken, t("tiledImport.group", { name: loaded.map.name }));
    const content = buildTiledContent(loaded, plans);
    const images = await newTiledImages(plans);
    closeTiled(loaded, new Set(images.map(i => i.bitmap)));
    // World tilesets (like syncing project data: no undo step of their own; the import is a new map).
    for (const image of images) setTilesetImage({ tilesetId: image.tileset.id, bitmap: image.bitmap, bytes: image.bytes });
    for (const image of images) active.dispatch({ type: "addTileset", tileset: image.tileset, undoable: false });
    const level = ws.add({
      name: loaded.map.name, width: loaded.map.width, height: loaded.map.height,
      tileSize: loaded.map.tileWidth, tileHeight: loaded.map.tileHeight, layerName: t("layers.defaultName"),
      layers: content.layers.map(l => ({ name: l.name || t("layers.defaultName"), visible: l.visible, opacity: l.opacity })),
      content: store => writeTiledLayers(store, content.layers, store.document.layers.map(l => l.id)),
    }, files);
    publishLevelState({ listChanged: true });
    const opened = await openLevel(level.id);
    const report: TiledImportReport = { name: level.name, layers: content.layers.length, tilesets: new Set(plans.filter(p => p).map(p => p!.tileset.id)).size, unsupported: content.unsupported };
    if (report.unsupported.length) useTiledImportReport.setState({ report });
    else toast.success(t("tiledImport.done", { name: report.name, layers: report.layers, tilesets: report.tilesets }));
    return opened;
  } catch (error) {
    closeTiled(loaded);
    console.error(error);
    toast.error(t("tiledImport.failed", { detail: tiledErrorDetail(error) }));
    return false;
  }
}

/** The menu / palette command. */
export async function importTiledFromPicker(): Promise<void> {
  if (!manualEditAllowed() || !useEditorStore.getState().project) return;
  const platform = getPlatform();
  const source = platform.pickTiledMap
    ? await platform.pickTiledMap({ name: t("tiledImport.filter"), extensions: MAP_EXTENSIONS })
    : await pickInBrowser();
  if (!source) return;
  await importTiledMap(source.path, source.read);
}
