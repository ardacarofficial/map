import { queueSmartStampRegeneration } from "../state/smartStampJobs";
export { waitForSmartStampRegeneration } from "../state/smartStampJobs";
import { useUiStore } from "../ui/uiStore";
import { sameBakeRecipe } from "../io/smartStampRecipes";
import { revealSection, useLayoutStore } from "../ui/layout/layoutStore";
import { terrainTemplateInfo, bakedNineSliceSolidTiles, bakedNineSliceTerrainSet, cellFlags, cellPaletteIndex, makeStampId, nineSliceProblem, prepareNineSliceTileset, type MapStore, type NineSliceInnerCorner, type Stamp, type StampNineSlice, type Tileset } from "@smap/core";
import { create } from "zustand";
import { useProjectLibrary } from "../io/projectLibrary";
import { useEditorStore } from "../state/editorStore";
import { allTilesetImages, getTilesetImage, onTilesetImage, notifyTilesetImage, removeTilesetImage, setTilesetImage, type TilesetImage } from "../state/tilesetImages";
import { bakeSmartStamp, pngHash } from "../ui/stamps/smartStampBake";
import { useStampLibrary } from "../ui/stamps/stampLibraryStore";
import { useToastStore, toast } from "../ui/toast/toastStore";
import { t } from "../i18n";
import { useTerrainDraft, startDraft, startFix, startDefine } from "../ui/terrain/terrainDraft";
import { registerCommands } from "./registry";
import { activeStampId, pickStamp } from "./stampActions";

export const useSmartStampDialog = create<{ stampId: string | null; roadChoiceId: string | null; open(id: string | null): void; chooseRoad(id: string | null): void }>()(set => ({ stampId: null, roadChoiceId: null, open: stampId => { if (stampId) { const toasts = useToastStore.getState(); for (const item of toasts.toasts) if (item.kind !== "error") toasts.dismiss(item.id); } set({ stampId }); }, chooseRoad: roadChoiceId => set({ roadChoiceId }) }));
export interface PreparedSmartStamp { readonly store: MapStore; readonly source: Stamp; readonly stamp: Stamp; readonly assets: readonly { tileset: Tileset; image: TilesetImage }[]; readonly sources: ReadonlyMap<string, TilesetImage> }

export async function prepareSmartStamp(stamp: Stamp, innerCorner?: NineSliceInnerCorner | null, targets?: ReadonlyMap<string, string>): Promise<PreparedSmartStamp> {
  const store = useEditorStore.getState().project?.store;
  if (!store) throw new Error("No project");
  const problem = nineSliceProblem(stamp);
  if (problem) throw new Error(problem);
  const doc = store.document, hashes = new Map<string, string>(), snapshots = new Map<string, TilesetImage>();
  const ids = new Set([...stamp.palette.map(e => e.tilesetId), ...(innerCorner ? [innerCorner.tile.tilesetId] : [])]);
  for (const old of doc.tilesets.filter(t => t.generated?.stampId === stamp.id)) {
    if (innerCorner === undefined && old.generated?.innerCorner) ids.add(old.generated.innerCorner.tile.tilesetId);
  }
  for (const id of ids) {
    const image = getTilesetImage(id);
    if (!image) throw new Error(t("toast.missingTilesetImage", { path: doc.getTileset(id)?.imagePath ?? id }));
    snapshots.set(id, image); hashes.set(id, await pngHash(image.bytes));
  }
  const assets: { tileset: Tileset; image: TilesetImage }[] = [], tileLayers: StampNineSlice["tileLayers"][number][] = [];
  let road: StampNineSlice["road"];
  try {
    for (const layer of stamp.layers.filter(l => !l.grid && (!targets || targets.has(l.layerId)))) {
      const old = doc.tilesets.find(t => (!targets || t.id === targets.get(layer.layerId)) && t.generated?.stampId === stamp.id && t.generated.layerId === layer.layerId && t.generated.sourceWidth === stamp.width && t.generated.sourceHeight === stamp.height && (targets || innerCorner === undefined || JSON.stringify(t.generated.innerCorner ?? null) === JSON.stringify(innerCorner)) && (targets || !useProjectLibrary.getState().generatedRecipes.some(r => r.tilesetId === t.id && !sameBakeRecipe(r.stamp, stamp))));
      const id = old?.id ?? makeStampId(`generated-${stamp.id}-${assets.length + 1}`, [...doc.tilesets.map(t => t.id), ...[...allTilesetImages()].map(i => i.tilesetId)]);
      let tileset = prepareNineSliceTileset(stamp, layer.layerId, { id, imagePath: old?.imagePath ?? `tilesets/${id}.png`, tileWidth: doc.map.tileWidth, tileHeight: doc.map.tileHeight, tilesets: doc.tilesets, imageHashes: hashes, ...(innerCorner !== undefined ? { innerCorner } : {}) });
      if (!nineSliceProblem(stamp, { roadLayerId: layer.layerId })) {
        const set = bakedNineSliceTerrainSet(stamp, layer.layerId, { id: "road", name: stamp.name, terrainId: 1 });
        tileset = { ...tileset, terrainSets: [set] };
        // A multi-layer stamp is area-only. Choosing a road layer must be an explicit operation.
        if (stamp.layers.length === 1) road = { tilesetId: id, setId: set.id, terrainId: 1 };
      }
      tileset = { ...tileset, group: old?.group ?? t("smartStamp.generated"), solidTiles: bakedNineSliceSolidTiles(stamp, layer.layerId, e => doc.getTileset(e.tilesetId)?.solidTiles?.includes(e.tileId) ?? false, tileset.generated?.innerCorner) };
      const image = await bakeSmartStamp(stamp, layer.layerId, tileset, doc.tilesets);
      assets.push({ tileset, image }); tileLayers.push({ layerId: layer.layerId, tilesetId: id });
    }
    for (const [id, snapshot] of snapshots) if (getTilesetImage(id) !== snapshot) throw new Error(t("smartStamp.changed"));
    return { store, sources: snapshots, source: stamp, stamp: Object.freeze({ ...stamp, nineSlice: { border: 1 as const, tileLayers, ...(road ? { road } : {}) } }), assets };
  } catch (error) { for (const a of assets) a.image.bitmap.close(); throw error; }
}
export function discardSmartStamp(prepared: PreparedSmartStamp): void { for (const a of prepared.assets) a.image.bitmap.close(); }

/** All decoding succeeds before any operation is dispatched. Metadata is published last. */
export function acceptSmartStamp(prepared: PreparedSmartStamp, regeneration = false): void {
  const store = useEditorStore.getState().project?.store;
  const current = useProjectLibrary.getState().stamps.find(s => s.id === prepared.source.id);
  if (!store || store !== prepared.store || (!regeneration && current !== prepared.source) || store.inTransaction) throw new Error(t("smartStamp.changed"));
  for (const [id, snapshot] of prepared.sources) if (getTilesetImage(id) !== snapshot) throw new Error(t("smartStamp.changed"));
  for (const a of prepared.assets) if (a.tileset.tileWidth !== store.document.map.tileWidth || a.tileset.tileHeight !== store.document.map.tileHeight) throw new Error(t("smartStamp.changed"));
  const added: string[] = [];
  store.beginTransaction();
  try {
    for (const a of prepared.assets) {
      const old = store.document.getTileset(a.tileset.id);
      if (old) {
        store.dispatch({ type: "setTilesetMeta", tilesetId: old.id, generated: a.tileset.generated!, name: a.tileset.name });
        // Rebuilding can change the chosen inner art and conservative solidity; all tags keep fixed slots.
        for (const set of a.tileset.terrainSets ?? []) if (!old.terrainSets?.some(s => s.id === set.id)) store.dispatch({ type: "setTerrainSet", tilesetId: old.id, set });
        if (!regeneration) {
          const solids = a.tileset.solidTiles ?? [], previous = old.solidTiles ?? [];
          store.dispatch({ type: "setTileSolid", tilesetId: old.id, tileIds: previous.filter(id => !solids.includes(id)), solid: false });
          store.dispatch({ type: "setTileSolid", tilesetId: old.id, tileIds: solids.filter(id => !previous.includes(id)), solid: true });
        }
      } else {
        added.push(a.tileset.id); setTilesetImage(a.image);
        store.dispatch({ type: "addTileset", tileset: a.tileset });
      }
    }
    store.commit();
  } catch (error) { store.rollback(); for (const id of added) removeTilesetImage(id); throw error; }
  for (const a of prepared.assets) if (!added.includes(a.tileset.id)) setTilesetImage(a.image);
  useProjectLibrary.getState().rememberGeneratedRecipes(prepared.assets.map(a => ({ tilesetId: a.tileset.id, stamp: prepared.source })));
  if (regeneration) return;
  useProjectLibrary.getState().addStamp(prepared.stamp);
  const editor = useEditorStore.getState();
  if (activeStampId(editor.stamp) === prepared.stamp.id) editor.setStamp(prepared.stamp);
}
export function disableSmartStamp(id: string): void {
  const stamp = useProjectLibrary.getState().stamps.find(s => s.id === id);
  if (!stamp?.nineSlice) return;
  const { nineSlice: _old, ...flat } = stamp;
  useProjectLibrary.getState().addStamp(flat);
  const editor = useEditorStore.getState();
  if (activeStampId(editor.stamp) === id) editor.setStamp(flat);
  // Ordinary generated tilesets remain available. Removal uses the existing project-wide usage dialog.
}
export function focusNineSlice(id: string): void {
  const editor = useEditorStore.getState(), tool = editor.tool;
  editor.setSelectedEntity(null);
  useUiStore.getState().setTilesetMode("pick");
  pickStamp(id);
  if (tool === "rect" || tool === "fill") editor.setTool(tool);
  revealSection("properties");
  useLayoutStore.getState().setRightTab("inspector");
  useStampLibrary.getState().requestFocus(id, "nineSlice");
}
export function stampToTerrain(id: string): void {
  const stamp = useProjectLibrary.getState().stamps.find(s => s.id === id);
  const doc = useEditorStore.getState().project?.store.document;
  if (!stamp || !doc) return;
  if (stamp.nineSlice) {
    const bank = stamp.nineSlice.road;
    if (bank) startFix(bank);
    else useSmartStampDialog.getState().chooseRoad(stamp.id);
    return;
  }
  const layer = stamp.layers.length === 1 ? stamp.layers[0] : undefined;
  if (!layer || layer.grid || layer.cells.some(c => c === 0 || cellFlags(c))) { toast.warning(t("smartStamp.nativeMissing")); return; }
  const entries = [...layer.cells].map(c => stamp.palette[cellPaletteIndex(c) - 1]!);
  const ts = doc.getTileset(entries[0]!.tilesetId), first = entries[0]!.tileId;
  if (!ts || entries.some((e, i) => e.tilesetId !== ts.id || e.tileId !== first + Math.floor(i / stamp.width) * ts.columns + i % stamp.width)) { toast.warning(t("smartStamp.nativeMissing")); return; }
  startDefine(ts.id);
  if (!startDraft(ts, { col: first % ts.columns, row: Math.floor(first / ts.columns), columns: stamp.width, rows: stamp.height })) toast.warning(t("smartStamp.nativeMissing"));
  const state = useTerrainDraft.getState(), draft = state.draft;
  if (draft) {
    const candidates = draft.candidates.filter(c => { const info = terrainTemplateInfo(c.template); return c.origin.col >= first % ts.columns && c.origin.row >= Math.floor(first / ts.columns) && c.origin.col + info.columns <= first % ts.columns + stamp.width && c.origin.row + info.rows <= Math.floor(first / ts.columns) + stamp.height; });
    state.setDraft({ ...draft, candidates, index: 0 });
  }
}
let installed = false;
export function installSmartStamps(): void {
  if (installed) return; installed = true;
  const selected = () => useStampLibrary.getState().selectedId ?? activeStampId(useEditorStore.getState().stamp);
  registerCommands([
    { id: "stamp.nineSlice", title: "smartStamp.command", category: "edit", enabled: () => !!selected(), run: () => { const id = selected(); if (id) focusNineSlice(id); } },
    { id: "stamp.toTerrain", title: "smartStamp.toTerrain", category: "edit", enabled: () => !!selected(), run: () => { const id = selected(); if (id) stampToTerrain(id); } },
  ]);
  let stopWatching: (() => void) | undefined;
  useEditorStore.subscribe((state, prev) => {
    if (state.project?.store !== prev.project?.store) {
      stopWatching?.();
      const store = state.project?.store;
      stopWatching = store?.subscribe(event => {
        if (!event.structure.includes("tilesets")) return;
        for (const stamp of useProjectLibrary.getState().stamps) if (stamp.nineSlice?.tileLayers.some(l => !store.document.getTileset(l.tilesetId))) disableSmartStamp(stamp.id);
      });
    }
    if (state.project?.store !== prev.project?.store && state.project) {
      for (const ts of state.project.store.document.tilesets) if (!ts.generated && getTilesetImage(ts.id)) notifyTilesetImage(ts.id);
    }
  });
  onTilesetImage(id => {
    const store = useEditorStore.getState().project?.store;
    if (!store) return;
    queueSmartStampRegeneration(async () => {
      if (useEditorStore.getState().project?.store !== store) return;
      if (store.inTransaction) await new Promise<void>(resolve => { const off = store.subscribe(() => { if (!store.inTransaction) { off(); resolve(); } }); });
      if (useEditorStore.getState().project?.store !== store) return;
      const sourceImage = getTilesetImage(id); if (!sourceImage) return;
      const hash = await pngHash(sourceImage.bytes);
      const library = useProjectLibrary.getState();
      const assets = store.document.tilesets.filter(t => t.generated?.sources.some(src => src.tilesetId === id && src.imageHash !== hash));
      for (const asset of assets) {
        const recipe = library.generatedRecipes.find(r => r.tilesetId === asset.id)?.stamp ?? library.stamps.find(s => s.id === asset.generated!.stampId);
        if (!recipe) throw new Error(t("smartStamp.recipeMissing", { name: asset.name }));
        const prepared = await prepareSmartStamp(recipe, asset.generated!.innerCorner ?? null, new Map([[asset.generated!.layerId, asset.id]]));
        if (useEditorStore.getState().project?.store !== store) { discardSmartStamp(prepared); return; }
        acceptSmartStamp(prepared, true);
      }
    }, (error: unknown) => { toast.error(t("smartStamp.failed", { detail: error instanceof Error ? error.message : String(error) })); });
  });
}
