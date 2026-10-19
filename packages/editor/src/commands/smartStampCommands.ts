import { smartBrushPreparationDebug, autoBrush, attachPreparedBrush, preparedBrush, brushCandidate, brushDisabled, refreshUnpublishedBrush, setBrushSmartEnabled } from "./smartBrushActions";
import { queueSmartStampRegeneration } from "../state/smartStampJobs";
export { waitForSmartStampRegeneration } from "../state/smartStampJobs";
import { sameBakeRecipe } from "../io/smartStampRecipes";
import { buildRoadProfile, makeStampId, nineSliceProblem, prepareNineSliceTileset, type MapStore, type NineSliceInnerCorner, type Stamp, type TileClip, type StampNineSlice, type Tileset } from "@smap/core";
import { useProjectLibrary } from "../io/projectLibrary";
import { useEditorStore } from "../state/editorStore";
import { allTilesetImages, getTilesetImage, onTilesetImage, notifyTilesetImage, removeTilesetImage, setTilesetImage, tilesetImageBytes, type TilesetImage } from "../state/tilesetImages";
import { bakeSmartStamp, pngHash } from "../ui/stamps/smartStampBake";
import { toast } from "../ui/toast/toastStore";
import { t } from "../i18n";
import { registerCommands } from "./registry";
import { activeStampId } from "./stampActions";
import { profileAwait, profileSpan, type BrushProfile } from "../state/smartBrushProfile";
import { cachedPngHash } from "../state/pngHash";

class SmartStampChangedError extends Error {
  constructor() { super(t("smartStamp.changed")); }
}
export interface PreparedSmartStamp { readonly store: MapStore; readonly source: Stamp; readonly stamp: Stamp; readonly assets: readonly { tileset: Tileset; image: TilesetImage }[]; readonly sources: ReadonlyMap<string, TilesetImage> }

export async function prepareSmartStamp(stamp: Stamp, innerCorner?: NineSliceInnerCorner | null, targets?: ReadonlyMap<string, string>, profile?: BrushProfile, ready?: (prepared: PreparedSmartStamp) => void): Promise<PreparedSmartStamp> {
  const gate = smartBrushPreparationDebug?.gate;
  if (gate) {
    smartBrushPreparationDebug!.entered++;
    if (await gate) throw new Error("Brush preparation failed (debug)");
  }
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
    snapshots.set(id, image);
    const cached = image.bytes && cachedPngHash(image.bytes);
    hashes.set(id, cached ?? await profileAwait(profile, "hash.sources", async () => pngHash(await tilesetImageBytes(image))));
  }
  const assets: { tileset: Tileset; image: TilesetImage }[] = [], tileLayers: StampNineSlice["tileLayers"][number][] = [];
  let road: StampNineSlice["road"];
  try {
    for (const layer of stamp.layers.filter(l => !l.grid && (!targets || targets.has(l.layerId)))) {
      const old = doc.tilesets.find(t => (!targets || t.id === targets.get(layer.layerId)) && t.generated?.stampId === stamp.id && t.generated.layerId === layer.layerId && t.generated.sourceWidth === stamp.width && t.generated.sourceHeight === stamp.height && (targets || innerCorner === undefined || JSON.stringify(t.generated.innerCorner ?? null) === JSON.stringify(innerCorner)) && (targets || !useProjectLibrary.getState().generatedRecipes.some(r => r.tilesetId === t.id && !sameBakeRecipe(r.stamp, stamp))));
      const id = old?.id ?? targets?.get(layer.layerId) ?? makeStampId(`generated-${stamp.id}-${assets.length + 1}`, [...doc.tilesets.map(t => t.id), ...[...allTilesetImages()].map(i => i.tilesetId)]);
      let tileset = profileSpan(profile, "metadata", () => prepareNineSliceTileset(stamp, layer.layerId, { id, imagePath: old?.imagePath ?? `tilesets/${id}.png`, tileWidth: doc.map.tileWidth, tileHeight: doc.map.tileHeight, tilesets: doc.tilesets, imageHashes: hashes, ...(innerCorner !== undefined ? { innerCorner } : {}) }));
      if (!nineSliceProblem(stamp, { roadLayerId: layer.layerId })) {
        const profile = old?.roadProfile ?? buildRoadProfile(stamp, layer.layerId);
        tileset = { ...tileset, roadProfile: profile };
        // Multi-layer stamps retain their existing area-only behavior.
        if (stamp.layers.length === 1) road = { tilesetId: id, profile };
      }
      tileset = { ...tileset, group: old?.group ?? t("smartStamp.generated") };
      const baked = bakeSmartStamp(stamp, layer.layerId, tileset, doc.tilesets, profile);
      const image = baked instanceof Promise ? await baked : baked;
      assets.push({ tileset, image }); tileLayers.push({ layerId: layer.layerId, tilesetId: id });
    }
    for (const [id, snapshot] of snapshots) if (getTilesetImage(id) !== snapshot) throw new SmartStampChangedError();
    const prepared = { store, sources: snapshots, source: stamp, stamp: Object.freeze({ ...stamp, nineSlice: { border: 1 as const, tileLayers, ...(road ? { road } : {}) } }), assets };
    // Publish synchronous in-memory preparation before selection-triggered React work.
    ready?.(prepared);
    return prepared;
  } catch (error) { for (const a of assets) a.image.bitmap.close(); throw error; }
}
export function discardSmartStamp(prepared: PreparedSmartStamp): void { for (const a of prepared.assets) a.image.bitmap.close(); }

/** All decoding succeeds before any operation is dispatched. Metadata is published last. */
export function acceptSmartStamp(prepared: PreparedSmartStamp, regeneration = false): void {
  const store = useEditorStore.getState().project?.store;
  const current = useProjectLibrary.getState().stamps.find(s => s.id === prepared.source.id);
  if (!store || store !== prepared.store || (!regeneration && current !== prepared.source) || store.inTransaction) throw new SmartStampChangedError();
  for (const [id, snapshot] of prepared.sources) if (getTilesetImage(id) !== snapshot) throw new SmartStampChangedError();
  for (const a of prepared.assets) if (a.tileset.tileWidth !== store.document.map.tileWidth || a.tileset.tileHeight !== store.document.map.tileHeight) throw new SmartStampChangedError();
  if (regeneration) {
    // Automatic image caches never enter map history. Core carries the latest
    // provenance across historical tileset snapshots, including remove/restore.
    for (const a of prepared.assets) if (!store.document.getTileset(a.tileset.id)) throw new SmartStampChangedError();
    for (const a of prepared.assets) {
      store.dispatch({ type: "setTilesetMeta", tilesetId: a.tileset.id, generated: a.tileset.generated!, undoable: false });
      setTilesetImage(a.image);
    }
    // Early v3 projects may have only the library fallback. Archive it before
    // a later library deletion can make this generated asset unrepairable.
    const missingRecipes = prepared.assets.filter(a => !useProjectLibrary.getState().generatedRecipes.some(r => r.tilesetId === a.tileset.id));
    if (missingRecipes.length) useProjectLibrary.getState().rememberGeneratedRecipes(missingRecipes.map(a => ({ tilesetId: a.tileset.id, stamp: prepared.source })));
    return;
  }
  const added: string[] = [];
  store.beginTransaction();
  try {
    for (const a of prepared.assets) {
      const old = store.document.getTileset(a.tileset.id);
      if (old) {
        store.dispatch({ type: "setTilesetMeta", tilesetId: old.id, name: a.tileset.name });
      } else {
        added.push(a.tileset.id); setTilesetImage(a.image);
        store.dispatch({ type: "addTileset", tileset: a.tileset });
      }
    }
    store.commit();
  } catch (error) { store.rollback(); for (const id of added) removeTilesetImage(id); throw error; }
  for (const a of prepared.assets) {
    if (!added.includes(a.tileset.id)) setTilesetImage(a.image);
    store.dispatch({ type: "setTilesetMeta", tilesetId: a.tileset.id, generated: a.tileset.generated!, undoable: false });
  }
  useProjectLibrary.getState().rememberGeneratedRecipes(prepared.assets.map(a => ({ tilesetId: a.tileset.id, stamp: prepared.source })));
  useProjectLibrary.getState().addStamp(prepared.stamp);
  const editor = useEditorStore.getState();
  if (activeStampId(editor.stamp) === prepared.stamp.id) editor.setStamp(prepared.stamp);
}
export function disableSmartStamp(id: string): void {
  const stamp = useProjectLibrary.getState().stamps.find(s => s.id === id);
  if (!stamp?.nineSlice) return;
  const flat = { ...stamp, smartDisabled: true };
  attachPreparedBrush(flat, stamp);
  useProjectLibrary.getState().addStamp(flat);
  const editor = useEditorStore.getState();
  if (activeStampId(editor.stamp) === id) editor.setStamp(flat);
  // Ordinary generated tilesets remain available. Removal uses the existing project-wide usage dialog.
}
let installed = false;
export function installSmartStamps(): void {
  if (installed) return; installed = true;
  registerCommands([
    { id: "stamp.nineSlice", title: "smartBrush.command", category: "edit", enabled: () => brushCandidate(), checked: () => !brushDisabled(useEditorStore.getState().stamp), run: () => setBrushSmartEnabled(brushDisabled(useEditorStore.getState().stamp)) },
  ]);
  let stopWatching: (() => void) | undefined;
  useEditorStore.subscribe((state, prev) => {
    if (state.project?.store !== prev.project?.store) {
      stopWatching?.();
      const store = state.project?.store;
      let suspended: TileClip | null = null;
      stopWatching = store?.subscribe(event => {
        if (!event.structure.includes("tilesets")) return;
        const editor = useEditorStore.getState(), selected = editor.stamp as Stamp | null;
        const missing = (stamp: Stamp) => stamp.nineSlice?.tileLayers.some(l => !store.document.getTileset(l.tilesetId));
        // Missing banks suspend the brush, never destroy the canonical recipe.
        // Undo/rollback restores availability from the same library metadata.
        const automatic = autoBrush(selected), candidate = preparedBrush(selected) ?? selected;
        if (automatic && candidate && missing(candidate) && (event.cause === "undo" || event.cause === "rollback")) { automatic.published = false; refreshUnpublishedBrush(selected); }
        if (candidate?.nineSlice && (!automatic || automatic.published) && missing(candidate)) { suspended = selected; editor.setStamp(null); }
        else if (suspended && !missing(preparedBrush(suspended) ?? suspended as Stamp)) {
          const canonical = useProjectLibrary.getState().stamps.find(s => s.id === (suspended as Stamp).id);
          if (!editor.stamp && (canonical === suspended || autoBrush(suspended))) editor.setStamp(suspended);
          suspended = null;
        }
      });
    }
    if (state.project?.store !== prev.project?.store && state.project) {
      for (const ts of state.project.store.document.tilesets) if (getTilesetImage(ts.id)) notifyTilesetImage(ts.id);
    }
  });
  onTilesetImage(id => {
    const store = useEditorStore.getState().project?.store;
    if (!store || !store.document.tilesets.some(t => t.generated?.sources.some(source => source.tilesetId === id))) return;
    queueSmartStampRegeneration(async () => {
      while (useEditorStore.getState().project?.store === store) {
        await waitForIdleStore(store);
        if (useEditorStore.getState().project?.store !== store) return;
        const sourceImage = getTilesetImage(id); if (!sourceImage) return;
        const hash = await pngHash(await tilesetImageBytes(sourceImage));
        if (useEditorStore.getState().project?.store !== store) return;
        if (getTilesetImage(id) !== sourceImage) continue;
        const asset = store.document.tilesets.find(t => t.generated?.sources.some(src => src.tilesetId === id && src.imageHash !== hash));
        if (!asset) return;
        const library = useProjectLibrary.getState();
        const recipe = library.generatedRecipes.find(r => r.tilesetId === asset.id)?.stamp ?? library.stamps.find(s => s.id === asset.generated!.stampId);
        if (!recipe) throw new Error(t("smartStamp.recipeMissing", { name: asset.name }));
        let prepared: PreparedSmartStamp | undefined, published = false;
        try {
          prepared = await prepareSmartStamp(recipe, asset.generated!.innerCorner ?? null, new Map([[asset.generated!.layerId, asset.id]]));
          // A gesture may have begun during preparation. Publication
          // waits again, then revalidates project, target and all source images.
          await waitForIdleStore(store);
          if (useEditorStore.getState().project?.store !== store) return;
          if (store.document.getTileset(asset.id) !== asset) continue;
          if (prepared.assets.length !== 1 || prepared.assets[0]!.tileset.id !== asset.id) throw new Error(t("smartStamp.recipeMissing", { name: asset.name }));
          acceptSmartStamp(prepared, true);
          published = true;
        } catch (error) {
          if (!(error instanceof SmartStampChangedError)) throw error;
          // Retry stale source snapshots against the newest images in this job.
        } finally {
          if (prepared && !published) discardSmartStamp(prepared);
        }
      }
    }, (error: unknown) => { toast.error(t("smartStamp.failed", { detail: error instanceof Error ? error.message : String(error) })); });
  });
}

/** Also releases a pending job when its project/level is closed mid-gesture. */
async function waitForIdleStore(store: MapStore): Promise<void> {
  if (!store.inTransaction || useEditorStore.getState().project?.store !== store) return;
  await new Promise<void>(resolve => {
    const done = () => {
      if (store.inTransaction && useEditorStore.getState().project?.store === store) return;
      offStore(); offEditor(); resolve();
    };
    const offStore = store.subscribe(done), offEditor = useEditorStore.subscribe(done);
  });
}
