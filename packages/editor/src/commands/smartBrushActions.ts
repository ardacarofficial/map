/** Shared preparation for dock brushes and saved stamps. Library entries are always explicit user saves. */
import { detectNineSliceSelection, type MapStore, type Stamp, type TileClip, type Tileset } from "@smap/core";
import { useEditorStore } from "../state/editorStore";
import { getTilesetImage, onTilesetImage, setTilesetImage, type TilesetImage } from "../state/tilesetImages";
import { tilesetPixels } from "../state/tilesetPixels";
import { brushProfile, profileSpan, type BrushProfile } from "../state/smartBrushProfile";
import { useProjectLibrary } from "../io/projectLibrary";
import { useTilesetView } from "../ui/tileset/tilesetViewStore";
import { refreshSmartStampSession } from "../ui/stamps/smartStampSession";
import { toast } from "../ui/toast/toastStore";
import { t } from "../i18n";
import { prepareSmartStamp, type PreparedSmartStamp } from "./smartStampCommands";

interface BrushRecord {
  readonly key: string;
  store: MapStore;
  readonly tileset: Tileset;
  readonly ids: readonly number[];
  readonly emptyIds: ReadonlySet<number>;
  image: TilesetImage;
  source: Stamp;
  targets?: ReadonlyMap<string, string>;
  prepared?: PreparedSmartStamp;
  pending: Promise<void>;
  failed: boolean;
  published: boolean;
}
const records = new WeakMap<TileClip, BrushRecord>();
let cacheStore: MapStore | undefined;
const cache = new Map<string, BrushRecord>();
const preferences = new Map<string, boolean>();

/** Deterministic async gate and timings, exposed only by the debug canvas hook. */
export const smartBrushPreparationDebug = import.meta.env.DEV || import.meta.env.VITE_SMAP_DEBUG === "1" ? {
  gate: null as Promise<boolean> | null,
  finish: null as ((fail: boolean) => void) | null,
  durations: [] as number[],
  profiles: [] as BrushProfile[],
  pending: 0,
  entered: 0,
  hold() {
    this.release();
    this.entered = 0;
    this.gate = new Promise(resolve => { this.finish = resolve; });
  },
  release(fail = false) { this.finish?.(fail); this.finish = null; this.gate = null; },
} : null;

export function autoBrush(clip: TileClip | null): BrushRecord | undefined { return clip ? records.get(clip) : undefined; }
export function brushCandidate(clip = useEditorStore.getState().stamp): boolean { return !!autoBrush(clip) || !!(clip as Stamp | null)?.nineSlice; }
export function preparedBrush(clip: TileClip | null): Stamp | null { return autoBrush(clip)?.prepared?.stamp ?? null; }
export function brushDisabled(clip: TileClip | null): boolean {
  return (clip as Stamp | null)?.id ? !!(clip as Stamp).smartDisabled : !!preferences.get(autoBrush(clip)?.key ?? "");
}
export function brushPending(): boolean {
  const clip = useEditorStore.getState().stamp, record = autoBrush(clip);
  return !!record && !record.prepared && !brushDisabled(clip);
}
function signal(record: BrushRecord): void {
  const editor = useEditorStore.getState();
  if (editor.project?.store === record.store && autoBrush(editor.stamp) === record) refreshSmartStampSession();
}

/** Inspect the original selection before the panel's empty-cell filtering can shrink its bounds. */
export function prepareSelectionBrush(tileset: Tileset, ids: readonly number[], emptyIds: ReadonlySet<number>, clip: TileClip): void {
  const started = performance.now();
  const profile = brushProfile();
  const store = useEditorStore.getState().project?.store, image = getTilesetImage(tileset.id);
  if (!store || !image || ids.length === 0) return;
  let col = Infinity, row = Infinity, right = 0, bottom = 0;
  for (const id of ids) {
    const x = id % tileset.columns, y = Math.floor(id / tileset.columns);
    col = Math.min(col, x); row = Math.min(row, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  const rect = { col, row, width: right - col + 1, height: bottom - row + 1 };
  if (rect.width < 3 || rect.height < 3 || ids.length !== rect.width * rect.height) return;
  const pixelRect = {
    x: tileset.margin + col * (tileset.tileWidth + tileset.spacing),
    y: tileset.margin + row * (tileset.tileHeight + tileset.spacing),
    width: rect.width * tileset.tileWidth + (rect.width - 1) * tileset.spacing,
    height: rect.height * tileset.tileHeight + (rect.height - 1) * tileset.spacing,
  };
  if (profile) profile.spans.geometry = performance.now() - started;
  const pixels = profileSpan(profile, "selection.pixels", () => tilesetPixels(image.bitmap, pixelRect));
  const detected = profileSpan(profile, "detector", () => detectNineSliceSelection({ tileset, rect, ids, emptyIds, pixels }));
  if (!detected) return;
  if (cacheStore !== store) { cache.clear(); preferences.clear(); cacheStore = store; }
  const key = profileSpan(profile, "cache.key", () => JSON.stringify([tileset.id, rect, tileset.tileWidth, tileset.tileHeight, tileset.margin, tileset.spacing, tileset.columns, tileset.rows, detected.version]));
  const hit = cache.get(key);
  if (hit && hit.image === image && !hit.failed) {
    records.set(clip, hit);
    if (hit.prepared && profile) { profile.spans.total = performance.now() - started; smartBrushPreparationDebug?.profiles.push(profile); smartBrushPreparationDebug?.durations.push(profile.spans.total); }
    return;
  }
  // Image bytes invalidate the cache, but never the recipe or atlas identity.
  let hash = 2166136261;
  for (const ch of key) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  const source: Stamp = {
    ...clip, id: `selection-${hash.toString(16)}`,
    name: hit?.prepared?.source.name ?? `${tileset.name} ${rect.width}×${rect.height} @ ${rect.col},${rect.row}`,
    layers: clip.layers.map(layer => ({ ...layer, layerId: "tileset", name: tileset.id })),
  };
  const targets = hit?.targets;
  const record: BrushRecord = { key, store, tileset, ids: [...ids], emptyIds, image, source, ...(targets ? { targets } : {}), pending: Promise.resolve(), failed: false, published: false };
  records.set(clip, record); cache.set(key, record);
  record.pending = runPreparation(record, source, targets, started, profile);
}
function runPreparation(record: BrushRecord, source: Stamp, targets?: ReadonlyMap<string, string>, started = performance.now(), profile = brushProfile()): Promise<void> {
  const { store, image, tileset } = record;
  const gate = smartBrushPreparationDebug?.gate;
  if (smartBrushPreparationDebug) smartBrushPreparationDebug.pending++;
  let measured = false;
  return prepareSmartStamp(source, undefined, targets, profile, prepared => {
    if (getTilesetImage(tileset.id) !== image || useEditorStore.getState().project?.store !== store) {
      for (const asset of prepared.assets) asset.image.bitmap.close();
      record.failed = true;
      return;
    }
    record.prepared = prepared; record.targets = new Map(prepared.assets.map(a => [a.tileset.generated!.layerId, a.tileset.id])); records.set(prepared.stamp, record);
    // Cached PNG bytes and preview textures are not document edits. Redo can reuse them.
    profileSpan(profile, "images.publish", () => { for (const asset of prepared.assets) if (getTilesetImage(asset.tileset.id) !== asset.image) setTilesetImage(asset.image); });
    profileSpan(profile, "signals", () => signal(record));
    if (!gate) {
      const total = performance.now() - started;
      smartBrushPreparationDebug?.durations.push(total);
      if (profile) { profile.spans.total = total; smartBrushPreparationDebug?.profiles.push(profile); }
      measured = true;
    }
  }).then(() => {}).catch(error => {
    record.failed = true;
    if (getTilesetImage(tileset.id) !== image || useEditorStore.getState().project?.store !== store) return;
    signal(record);
    toast.error(t("smartStamp.failed", { detail: String(error) }));
  }).finally(() => {
    if (smartBrushPreparationDebug) smartBrushPreparationDebug.pending--;
    if (!gate && !measured) smartBrushPreparationDebug?.durations.push(performance.now() - started);
    if (!gate && !measured && profile) { profile.spans.total = performance.now() - started; smartBrushPreparationDebug?.profiles.push(profile); }
  });
}
export async function waitForSelectionBrush(clip: TileClip): Promise<PreparedSmartStamp | undefined> {
  const record = autoBrush(clip);
  if (record) {
    let observed: Promise<void>;
    do { observed = record.pending; await observed; refreshUnpublishedBrush(clip); } while (observed !== record.pending);
  }
  if (record && !record.prepared) throw new Error(t("smartStamp.changed"));
  return record?.prepared;
}

/** The first press→release transaction owns both atlas metadata and its cell writes. */
export function publishBrushAssets(clip: TileClip | null, store: MapStore): void {
  const record = autoBrush(clip), prepared = record?.prepared;
  if (!prepared) return;
  if (!store.inTransaction || useEditorStore.getState().project?.store !== store) throw new Error(t("smartStamp.changed"));
  for (const asset of prepared.assets) {
    if (asset.tileset.tileWidth !== store.document.map.tileWidth || asset.tileset.tileHeight !== store.document.map.tileHeight) throw new Error(t("smartStamp.changed"));
    const existing = store.document.getTileset(asset.tileset.id);
    if (existing) {
      if (existing.generated?.stampId !== asset.tileset.generated?.stampId || existing.generated?.layerId !== asset.tileset.generated?.layerId) throw new Error(t("smartStamp.changed"));
      continue;
    }
    for (const [id, image] of prepared.sources) if (!store.document.getTileset(id) || getTilesetImage(id) !== image) throw new Error(t("smartStamp.changed"));
    const name = (clip as Stamp).id ? (clip as Stamp).name : prepared.source.name;
    store.dispatch({ type: "addTileset", tileset: { ...asset.tileset, name: `${name} (yol)` } });
  }
  record!.published = true;
  const stop = store.subscribe(event => {
    if ((event.cause !== "commit" && event.cause !== "rollback") || store.inTransaction) return;
    stop();
    if (event.cause === "rollback") { record!.published = false; return; }
    const library = useProjectLibrary.getState();
    if (prepared.assets.some(a => !library.generatedRecipes.some(r => r.tilesetId === a.tileset.id))) {
      library.rememberGeneratedRecipes(prepared.assets.map(a => ({ tilesetId: a.tileset.id, stamp: prepared.source })));
    }
  });
}
export function attachPreparedBrush(clip: TileClip, from: TileClip): void {
  const record = autoBrush(from); if (record) records.set(clip, record);
}
export function setBrushSmartEnabled(enabled: boolean): void {
  const editor = useEditorStore.getState(), clip = editor.stamp;
  if (!clip || !brushCandidate(clip)) return;
  const record = autoBrush(clip), stamp = clip as Stamp, next = { ...clip, smartDisabled: !enabled };
  if (record) { if (!stamp.id) preferences.set(record.key, !enabled); records.set(next, record); }
  if (stamp.id && useProjectLibrary.getState().stamps.some(s => s.id === stamp.id)) useProjectLibrary.getState().addStamp(next as Stamp);
  const view = useTilesetView.getState();
  if (view.selection?.clip === clip) view.setSelection({ ...view.selection, clip: next });
  editor.setStamp(next);
}
/** Saving an unused library brush must also save its PNG and recipe, including Save As from another level. */
export async function publishSavedBrushAssets(): Promise<void> {
  const store = useEditorStore.getState().project?.store; if (!store) return;
  for (const stamp of useProjectLibrary.getState().stamps) {
    await waitForSelectionBrush(stamp);
    const missing = autoBrush(stamp)?.prepared?.assets.filter(a => !store.document.getTileset(a.tileset.id));
    // Recipes are archived only after publication commits, and survive removal/undo.
    // A missing archived atlas was removed; Save must preserve that decision and redo.
    const recipes = useProjectLibrary.getState().generatedRecipes;
    if (!missing?.length || missing.some(a => recipes.some(r => r.tilesetId === a.tileset.id))) continue;
    if (store.inTransaction) throw new Error(t("smartStamp.changed"));
    store.beginTransaction();
    try { publishBrushAssets(stamp, store); store.commit(); }
    catch (error) { store.rollback(); throw error; }
  }
}
export function brushPreviewTilesets(stamp: Stamp): readonly Tileset[] { return autoBrush(stamp)?.prepared?.assets.map(a => a.tileset) ?? []; }

/** Refresh an existing recipe rather than reclassifying artwork edited after detection. */
export function refreshUnpublishedBrush(clip: TileClip | null): void {
  const record = autoBrush(clip), editor = useEditorStore.getState(), store = editor.project?.store;
  if (!record || !store) return;
  const image = getTilesetImage(record.tileset.id);
  if (!image || image === record.image || record.prepared?.assets.every(a => store.document.getTileset(a.tileset.id))) return;
  const prepared = record.prepared;
  const targets = record.targets;
  const source = prepared?.source ?? record.source;
  record.image = image; record.store = store; delete record.prepared; record.failed = false;
  signal(record);
  record.pending = runPreparation(record, source, targets);
}

// Published sheets use the existing serialized regeneration jobs. Unpublished recipes must also
// follow source PNG edits, including edits made after undoing the first stroke.
onTilesetImage(id => {
  const editor = useEditorStore.getState(), clips = [editor.stamp, ...useProjectLibrary.getState().stamps];
  const affected = new Set(clips.flatMap(clip => { const record = autoBrush(clip); return record?.tileset.id === id ? [record] : []; }));
  for (const record of affected) {
    if (getTilesetImage(id) === record.image || record.prepared?.assets.every(a => editor.project?.store.document.getTileset(a.tileset.id))) continue;
    void record.pending.then(() => {
      const current = useEditorStore.getState();
      const associated = [current.stamp, ...useProjectLibrary.getState().stamps].find(clip => autoBrush(clip) === record);
      if (associated) refreshUnpublishedBrush(associated);
    });
  }
});
