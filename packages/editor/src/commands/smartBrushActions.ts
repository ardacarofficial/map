import { pngHash } from "../state/pngHash";
import { tilesetImageBytes } from "../state/tilesetImages";
import { waitForSmartStampRegeneration } from "../state/smartStampJobs";
import { rememberSourcePreview, copySourcePreview } from "../ui/stamps/stampThumb";
/** Shared preparation for dock brushes and saved stamps. Library entries are always explicit user saves. */
import { SmartBrushError, formatSmartBrushError, smartBrushError, logSmartBrush } from "./smartBrushErrors";
import { imageContentVersion, sourceVersionMatches, tilesetSourceVersion, tilesetWorldVersion, type SourceVersion } from "../state/tilesetImages";
import { detectNineSliceSelection, type MapStore, type Stamp, type TileClip, type Tileset } from "@smap/core";
import { useEditorStore } from "../state/editorStore";
import { getTilesetImage, onTilesetImage, setTilesetImage, type TilesetImage } from "../state/tilesetImages";
import { tilesetPixels } from "../state/tilesetPixels";
import { brushProfile, profileSpan, type BrushProfile } from "../state/smartBrushProfile";
import { useProjectLibrary } from "../io/projectLibrary";
import { sameBakeRecipe } from "../io/smartStampRecipes";
import { useTilesetView } from "../ui/tileset/tilesetViewStore";
import { refreshSmartStampSession } from "../ui/stamps/smartStampSession";
import { toast } from "../ui/toast/toastStore";
import { t } from "../i18n";
import { prepareSmartStamp, waitForIdleStore, type PreparedSmartStamp } from "./smartStampCommands";

export type BrushPreparationState =
 | {readonly status:"plain";readonly reason:"not-repeatable"}
 | {readonly status:"preparing"|"retrying";readonly job:number;readonly previous?:PreparedSmartStamp}
 | {readonly status:"ready";readonly prepared:PreparedSmartStamp}
 | {readonly status:"failed";readonly error:SmartBrushError}
 | {readonly status:"unavailable";readonly error:SmartBrushError;readonly previous?:PreparedSmartStamp}
 | {readonly status:"cancelled"};
interface BrushRecord {
  readonly key: string;
  store: MapStore;
  tileset: Tileset;
  readonly worldVersion: number;
  version: SourceVersion;
  state: BrushPreparationState;
  generation: number;
  readonly ids: readonly number[];
  readonly emptyIds: ReadonlySet<number>;
  image: TilesetImage;
  source: Stamp;
  targets?: ReadonlyMap<string, string>;
  readonly prepared: PreparedSmartStamp | undefined;
  pending: Promise<void>;
  readonly failed: boolean;
  published: boolean;
}
interface SourceSelection {readonly tileset:Tileset;readonly ids:readonly number[];readonly emptyIds:ReadonlySet<number>}
const selections=new WeakMap<TileClip,SourceSelection>();
export function brushSource(clip:TileClip|null): Tileset|undefined {return clip ? selections.get(clip)?.tileset ?? autoBrush(clip)?.tileset ?? ((clip as Stamp).nineSlice ? useEditorStore.getState().project?.store.document.getTileset(clip.palette[0]?.tilesetId??"") : undefined) : undefined;}
export function brushUnavailable(clip:TileClip|null): SmartBrushError|undefined {
 const store=useEditorStore.getState().project?.store,source=brushSource(clip);
 if(source&&store){const current=store.document.getTileset(source.id);if(!current||(autoBrush(clip)&&!getTilesetImage(source.id)))return new SmartBrushError("sourceMissing");if(current.tileWidth!==store.document.map.tileWidth||current.tileHeight!==store.document.map.tileHeight)return new SmartBrushError("gridMismatch");}
 const state=autoBrush(clip)?.state;return state?.status==="failed"||state?.status==="unavailable"?state.error:undefined;
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
function retainedPreparation(record:BrushRecord|undefined):PreparedSmartStamp|undefined {
  return record?.prepared ?? (record?.state.status==="unavailable"?record.state.previous:undefined);
}
export function brushCandidate(clip = useEditorStore.getState().stamp): boolean { return !!autoBrush(clip) || !!(clip as Stamp | null)?.nineSlice; }
export function brushPreparationState(clip:TileClip|null):BrushPreparationState|{readonly status:"ready";readonly stored:Stamp} {
 const unavailable=brushUnavailable(clip);if(unavailable&&autoBrush(clip)?.state.status!=="failed")return {status:"unavailable",error:unavailable};
 const record=autoBrush(clip);if(record)return record.state;
 if((clip as Stamp|null)?.nineSlice)return {status:"ready",stored:clip as Stamp};
 return {status:"plain",reason:"not-repeatable"};
}
export function preparedBrush(clip: TileClip | null): Stamp | null { return brushUnavailable(clip) ? null : autoBrush(clip)?.prepared?.stamp ?? null; }
export function brushDisabled(clip: TileClip | null): boolean {
  if(autoBrush(clip)?.state.status!=="failed" && brushUnavailable(clip))return true;
  return (clip as Stamp | null)?.id ? !!(clip as Stamp).smartDisabled : !!preferences.get(autoBrush(clip)?.key ?? "");
}
export function brushPending(): boolean {
  const clip = useEditorStore.getState().stamp, record = autoBrush(clip);
  return !!record && (record.state.status === "preparing" || record.state.status === "retrying") && !brushDisabled(clip);
}
function signal(record: BrushRecord): void {
  const editor = useEditorStore.getState();
  logSmartBrush("state",{world:record.worldVersion,level:editor.project?.levelId,status:record.state.status,source:record.tileset.id,native:[record.tileset.tileWidth,record.tileset.tileHeight],map:editor.project?[editor.project.store.document.map.tileWidth,editor.project.store.document.map.tileHeight]:null,version:record.version,...(record.state.status==="failed"||record.state.status==="unavailable"?{code:record.state.error.code}:{})});
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
  selections.set(clip,{tileset,ids:[...ids],emptyIds});
  rememberSourcePreview(clip,tileset);
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
  logSmartBrush("selection",{level:useEditorStore.getState().project?.levelId,source:tileset.id,native:[tileset.tileWidth,tileset.tileHeight],map:[store.document.map.tileWidth,store.document.map.tileHeight],rect,band:detected?.border,reason:detected?.reason??"plain"});
  if (!detected) return;
  if (cacheStore !== store) { cache.clear(); preferences.clear(); cacheStore = store; }
  const key = profileSpan(profile, "cache.key", () => JSON.stringify([tileset.id, rect, tileset.tileWidth, tileset.tileHeight, tileset.margin, tileset.spacing, tileset.columns, tileset.rows, detected.version, detected.border, detected.border > 1 ? 2 : 1]));
  const hit = cache.get(key);
  if (hit && hit.version.content === imageContentVersion(image) && !hit.failed) {
    records.set(clip, hit);
    refreshUnpublishedBrush(clip);
    if (hit.prepared && profile) { profile.spans.total = performance.now() - started; smartBrushPreparationDebug?.profiles.push(profile); smartBrushPreparationDebug?.durations.push(profile.spans.total); }
    return;
  }
  // Image bytes invalidate the cache, but never the recipe or atlas identity.
  // Recipe identity has its own stable ABI: preserve the detector-1 b=1 key.
  // Classification thresholds invalidate preparation caches, never persisted families.
  const identity = JSON.stringify([tileset.id, rect, tileset.tileWidth, tileset.tileHeight, tileset.margin, tileset.spacing, tileset.columns, tileset.rows, 1, ...(detected.border > 1 ? [detected.border, 2] : [])]);
  let hash = 2166136261;
  for (const ch of identity) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  let source: Stamp = {
    ...clip, nineSlice: { border: detected.border, tileLayers: [] }, id: `selection-${hash.toString(16)}`,
    name: hit?.prepared?.source.name ?? `${tileset.name} ${rect.width}×${rect.height} @ ${rect.col},${rect.row}`,
    layers: clip.layers.map(layer => ({ ...layer, layerId: "tileset", name: tileset.id })),
  };
  // Also recognize already-written selections from other detector versions by
  // their actual recipe. Keep the archived id so provenance and road membership
  // continue using exactly the same atlas, including pre-upgrade layout 1.
  const library = useProjectLibrary.getState();
  for (const asset of store.document.tilesets) {
    const g = asset.generated;
    if (!g?.stampId.startsWith("selection-") || (g.border ?? 1) !== detected.border || g.sourceWidth !== source.width || g.sourceHeight !== source.height) continue;
    const recipe = library.generatedRecipes.find(r => r.tilesetId === asset.id)?.stamp ?? library.stamps.find(s => s.id === g.stampId);
    if (recipe && recipe.id === g.stampId && sameBakeRecipe(recipe, source)) { source = { ...source, id: recipe.id, name: recipe.name }; break; }
  }
  const targets = hit?.targets;
  const record: BrushRecord = { key, store, tileset, ids: [...ids], emptyIds, image, source, version:tilesetSourceVersion(tileset,image), worldVersion:tilesetWorldVersion(), state:{status:"preparing",job:0},generation:0, get prepared(){return this.state.status==="ready"?this.state.prepared:this.state.status==="retrying"?this.state.previous:undefined;},get failed(){return this.state.status==="failed";}, ...(targets ? { targets } : {}), pending: Promise.resolve(), published: false };
  records.set(clip, record); cache.set(key, record);
  if(brushUnavailable(clip)){record.state={status:"unavailable",error:brushUnavailable(clip)!};signal(record);return;}
  record.pending = runPreparation(record, source, targets, started, profile);
}
function runPreparation(record: BrushRecord, source: Stamp, targets?: ReadonlyMap<string, string>, started = performance.now(), profile = brushProfile()): Promise<void> {
  const { store, tileset } = record, job=++record.generation, previous=retainedPreparation(record);
  record.state={status:previous?"retrying":"preparing",job,...(previous?{previous}:{})};
  logSmartBrush("preparing",{world:record.worldVersion,level:useEditorStore.getState().project?.levelId,source:tileset.id,version:record.version,recipe:record.key,job});
  const gate=smartBrushPreparationDebug?.gate;
  if(smartBrushPreparationDebug)smartBrushPreparationDebug.pending++;
  return prepareSmartStamp(source,undefined,targets,profile,prepared=>{
    if(job!==record.generation || record.worldVersion!==tilesetWorldVersion() || !sourceVersionMatches(tileset.id,record.version,store.document.getTileset(tileset.id))){
      for(const asset of prepared.assets)asset.image.bitmap.close();
      if(job===record.generation)record.state={status:"cancelled"};return;
    }
    const active=useEditorStore.getState().project?.store;
    record.state=active&&(tileset.tileWidth!==active.document.map.tileWidth||tileset.tileHeight!==active.document.map.tileHeight)?{status:"unavailable",error:new SmartBrushError("gridMismatch"),previous:prepared}:{status:"ready",prepared};
    record.targets=new Map(prepared.assets.map(a=>[a.tileset.generated!.layerId,a.tileset.id]));records.set(prepared.stamp,record);
    profileSpan(profile,"images.publish",()=>{for(const asset of prepared.assets)if(getTilesetImage(asset.tileset.id)!==asset.image)setTilesetImage(asset.image);});
    logSmartBrush("ready",{world:record.worldVersion,source:tileset.id,job});signal(record);
  }).then(()=>{}).catch(error=>{
    if(job!==record.generation)return;
    const active=useEditorStore.getState().project?.store;
    if(active && (tileset.tileWidth!==active.document.map.tileWidth||tileset.tileHeight!==active.document.map.tileHeight)){
      const previous=retainedPreparation(record);
    record.state={status:"unavailable",error:new SmartBrushError("gridMismatch"),...(previous?{previous}:{})};signal(record);return;
    }
    const failure=smartBrushError(error);
    record.state=failure.code==="sourceChanged"||record.worldVersion!==tilesetWorldVersion()?{status:"cancelled"}:{status:"failed",error:failure};
    logSmartBrush("failure",{world:record.worldVersion,source:tileset.id,job,code:failure.code});
    signal(record);
    if(record.state.status==="failed"){const detail=formatSmartBrushError(error);if(detail)toast.error(t("smartStamp.failed",{detail}));}
  }).finally(()=>{
    if(smartBrushPreparationDebug)smartBrushPreparationDebug.pending--;
    if(!gate){const total=performance.now()-started;smartBrushPreparationDebug?.durations.push(total);if(profile){profile.spans.total=total;smartBrushPreparationDebug?.profiles.push(profile);}}
  });
}
export async function waitForSelectionBrush(clip: TileClip): Promise<PreparedSmartStamp | undefined> {
  const record = autoBrush(clip);
  if (brushUnavailable(clip)?.code === "gridMismatch")return undefined;
  if (record) {
    let observed: Promise<void>;
    do { observed = record.pending; await observed; refreshUnpublishedBrush(clip); } while (observed !== record.pending);
  }
  if(record?.state.status==="failed"||record?.state.status==="unavailable")throw record.state.error;
  if (record && !record.prepared) throw new SmartBrushError("cancelled");
  return record?.prepared;
}

/** The first press→release transaction owns both atlas metadata and its cell writes. */
export function publishBrushAssets(clip: TileClip | null, store: MapStore, saving = false): void {
  const record = autoBrush(clip), prepared = saving?retainedPreparation(record):record?.prepared;
  if (!prepared) return;
  if(!saving&&record!.state.status!=="ready")throw new SmartBrushError("sourceChanged");
  if(record!.worldVersion!==tilesetWorldVersion())throw new SmartBrushError("cancelled");
  for(const [id,version]of prepared.sources)if(!sourceVersionMatches(id,version,store.document.getTileset(id)))throw new SmartBrushError("sourceChanged");
  if (!store.inTransaction || useEditorStore.getState().project?.store !== store) throw new SmartBrushError("sourceChanged");
  for (const asset of prepared.assets) {
    if (!saving&&(asset.tileset.tileWidth !== store.document.map.tileWidth || asset.tileset.tileHeight !== store.document.map.tileHeight)) throw new SmartBrushError("gridMismatch");
    const existing = store.document.getTileset(asset.tileset.id);
    if (existing) {
      if (existing.generated?.stampId !== asset.tileset.generated?.stampId || existing.generated?.layerId !== asset.tileset.generated?.layerId) throw new SmartBrushError("sourceChanged");
      continue;
    }
    for (const [id, image] of prepared.sources) if (!store.document.getTileset(id) || !sourceVersionMatches(id,image,store.document.getTileset(id))) throw new SmartBrushError("sourceChanged");
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
  copySourcePreview(clip,from);
  const selection=selections.get(from);if(selection)selections.set(clip,selection);
}
export function setBrushSmartEnabled(enabled: boolean): void {
  const editor = useEditorStore.getState(), clip = editor.stamp;
  if (!clip || !brushCandidate(clip)) return;
  const record = autoBrush(clip), stamp = clip as Stamp, next = { ...clip, smartDisabled: !enabled };
  if (record) { if (!stamp.id) preferences.set(record.key, !enabled); }
  attachPreparedBrush(next,clip);
  if (stamp.id && useProjectLibrary.getState().stamps.some(s => s.id === stamp.id)) useProjectLibrary.getState().addStamp(next as Stamp);
  const view = useTilesetView.getState();
  if (view.selection?.clip === clip) view.setSelection({ ...view.selection, clip: next });
  editor.setStamp(next);
}
/** Saving an unused library brush must also save its PNG and recipe, including Save As from another level. */
export async function publishSavedBrushAssets(): Promise<void> {
  const world=tilesetWorldVersion();
  for (const stamp of useProjectLibrary.getState().stamps) {
    await waitForSelectionBrush(stamp);
    const record=autoBrush(stamp);let prepared=retainedPreparation(record);
    let store=useEditorStore.getState().project?.store;
    if(!store||world!==tilesetWorldVersion())return;
    const recipes=useProjectLibrary.getState().generatedRecipes;
    let missing=prepared?.assets.filter(a=>!store!.document.getTileset(a.tileset.id));
    // Never resurrect intentionally removed/undone archived assets on Save.
    if(!record||!prepared||!missing?.length||missing.some(a=>recipes.some(r=>r.tilesetId===a.tileset.id)))continue;
    if([...prepared.sources].some(([id,version])=>!sourceVersionMatches(id,version,store!.document.getTileset(id)))){
      // Asset persistence belongs to the world recipe's native grid. The
      // active map's painting eligibility is a separate, unchanged fact.
      const native=prepared.assets[0]!.tileset;
      prepared=await prepareSmartStamp(record.source,undefined,record.targets,undefined,undefined,native);
      records.set(prepared.stamp,record);
      for(const asset of prepared.assets)setTilesetImage(asset.image);
      record.image=getTilesetImage(record.tileset.id)!;
      record.version=tilesetSourceVersion(record.tileset,record.image);
      record.state=brushUnavailable(stamp)?.code==="gridMismatch"?{status:"unavailable",error:new SmartBrushError("gridMismatch"),previous:prepared}:{status:"ready",prepared};
    }
    // A map can switch while preparing/encoding. Publish on the current idle
    // store, rechecking the world rather than rejecting an unrelated tab change.
    do {
      store=useEditorStore.getState().project?.store;
      if(!store||world!==tilesetWorldVersion())return;
      await waitForIdleStore(store);
    }while(store!==useEditorStore.getState().project?.store||store.inTransaction);
    missing=prepared.assets.filter(a=>!store.document.getTileset(a.tileset.id));
    if(!missing.length)continue;
    store.beginTransaction();
    try { publishBrushAssets(stamp,store,true);store.commit(); }
    catch(error){store.rollback();throw error;}
  }
}
export function brushPreviewTilesets(stamp: Stamp): readonly Tileset[] { return autoBrush(stamp)?.prepared?.assets.map(a => a.tileset) ?? []; }

/** Refresh an existing recipe rather than reclassifying artwork edited after detection. */
export function refreshUnpublishedBrush(clip: TileClip | null): void {
  const record=autoBrush(clip),store=useEditorStore.getState().project?.store;
  if(!record||!store)return;
  if(record.worldVersion!==tilesetWorldVersion()){record.state={status:"cancelled"};return;}
  const tileset=store.document.getTileset(record.tileset.id),image=getTilesetImage(record.tileset.id);
  if(!tileset||!image){record.state={status:"unavailable",error:new SmartBrushError("sourceMissing")};signal(record);return;}
  record.store=store;
  if(tileset.tileWidth!==store.document.map.tileWidth||tileset.tileHeight!==store.document.map.tileHeight){
    const previous=retainedPreparation(record);
    record.state={status:"unavailable",error:new SmartBrushError("gridMismatch"),...(previous?{previous}:{})};signal(record);return;
  }
  if(record.version.grid!==tilesetSourceVersion(tileset,image).grid){record.state={status:"unavailable",error:new SmartBrushError("invalidSource")};signal(record);return;}
  const retained=retainedPreparation(record);
  if(record.state.status==="unavailable"&&retained&&[...retained.sources].every(([id,version])=>sourceVersionMatches(id,version,store.document.getTileset(id)))){
    record.state={status:"ready",prepared:retained};signal(record);return;
  }
  if(record.version.content===imageContentVersion(image) && record.state.status!=="unavailable" && record.state.status!=="cancelled")return;
  // Published banks regenerate through one serialized job. Keep the previous
  // preview, but buffer commits until that bank's newest revision is published.
  const previous=record.prepared;
  if(previous?.assets.every(a=>store.document.getTileset(a.tileset.id))){
    const job=++record.generation;record.image=image;record.version=tilesetSourceVersion(tileset,image);
    record.state={status:"retrying",job,previous};
    record.pending=waitForSmartStampRegeneration().then(async()=>{
      if(record.worldVersion!==tilesetWorldVersion()){record.state={status:"cancelled"};return;}
      if(previous.assets.some(a=>!store.document.getTileset(a.tileset.id))){
        record.state={status:"cancelled"};refreshUnpublishedBrush(clip);return;
      }
      const latest=getTilesetImage(tileset.id),currentSource=store.document.getTileset(tileset.id);
      if(!latest||!currentSource)throw new SmartBrushError("sourceMissing");
      const hash=await pngHash(await tilesetImageBytes(latest));
      if(previous.assets.some(a=>store.document.getTileset(a.tileset.id)?.generated?.sources.some(s=>s.tilesetId===tileset.id&&s.imageHash!==hash)))throw new SmartBrushError("io");
      record.image=latest;record.version=tilesetSourceVersion(currentSource,latest);
      record.state={status:"ready",prepared:{...previous,sources:new Map(previous.sources).set(tileset.id,record.version),assets:previous.assets.map(a=>({tileset:store.document.getTileset(a.tileset.id)??a.tileset,image:getTilesetImage(a.tileset.id)??a.image}))}};
      signal(record);
    }).catch(error=>{record.state={status:"failed",error:smartBrushError(error)};signal(record);});
    signal(record);return;
  }
  record.image=image;record.tileset=tileset;record.version=tilesetSourceVersion(tileset,image);
  record.pending=runPreparation(record,record.source,record.targets);signal(record);
}

// Published sheets use the existing serialized regeneration jobs. Unpublished recipes must also
// follow source PNG edits, including edits made after undoing the first stroke.
onTilesetImage(id => {
  const editor = useEditorStore.getState(), clips = [editor.stamp, ...useProjectLibrary.getState().stamps];
  const affected = new Set(clips.flatMap(clip => { const record = autoBrush(clip); return record?.tileset.id === id ? [record] : []; }));
  for (const record of affected) {
    if (getTilesetImage(id) && record.version.content === imageContentVersion(getTilesetImage(id)!)) continue;
    void record.pending.then(() => {
      const current = useEditorStore.getState();
      const associated = [current.stamp, ...useProjectLibrary.getState().stamps].find(clip => autoBrush(clip) === record);
      if (associated) refreshUnpublishedBrush(associated);
    });
  }
});
