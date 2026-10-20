/** Explicit file action; never participates in paint undo or remaps cells. */
import { create } from 'zustand';
import { rasterContentHash, tileRect, type MapStore, type RasterImage, type Tileset } from '@smap/core';
import { t, type MessageKey } from '../i18n';
import { getLevelWorkspace, getProjectFolder, withProjectWriteGate } from '../io/session';
import { scanWorldUsages } from '../extras/usageScan';
import { scanUsageFile } from '../extras/usageWorker';
import { applyPngPatch, equalPngBytes, listPngBackups, pngBackupPath, PngChangedError, preparePngPatch, restorePngBackup } from '../io/pngWriteback';
import { decodeSourcePng } from '../io/sourcePng';
import { isSnapshotImagePath } from '../io/immutableFiles';
import { reloadTilesetImage } from '../platform/fileChanges';
import { useEditorStore } from '../state/editorStore';
import { pixelSourceGrid } from '../state/pixelProvenance';
import { toast } from '../ui/toast/toastStore';
import { registerTilesetModal } from '../ui/tilesetImport/importStore';
import { registerCommands } from './registry';

type Reason = 'road' | 'missing' | 'size' | 'grid' | 'gridChanged' | 'snapshot';
export interface PngVariant {
  readonly key: string;
  readonly edited: Tileset;
  readonly tileId: number;
  readonly source: Tileset | undefined;
  readonly sourceTileId: number;
  readonly baseHash: string;
  readonly pixels: RasterImage | undefined;
  readonly reason: Reason | undefined;
}
export function collectPngVariants(store: MapStore): PngVariant[] {
  return store.document.tilesets.flatMap(edited => edited.edited ? Array.from({length:edited.edited.nextTileId},(_,tileId) => {
    let origin=edited.edited!.origins.find(o=>o.tileId===tileId);
    let source=origin&&store.document.getTileset(origin.sourceTilesetId);
    const pixels=store.rasterAssets.getTile(edited.id,tileId), seen=new Set<string>();
    // Shared edited tiles can themselves be copied. Follow their append-only
    // origins to the first real PNG, retaining that PNG's captured base/grid.
    while(source?.edited && !source.generated && origin) {
      const key=JSON.stringify([source.id,origin.sourceTileId]);
      if(seen.has(key)){source=undefined;break;} seen.add(key);
      origin=source.edited.origins.find(o=>o.tileId===origin!.sourceTileId);
      source=origin&&store.document.getTileset(origin.sourceTilesetId);
    }
    const reason:Reason|undefined=!source||!pixels||!origin||origin.sourceTileId>=source.columns*source.rows ? 'missing' : isSnapshotImagePath(source.imagePath) ? 'snapshot' : source.generated ? 'road' : pixels.width!==source.tileWidth||pixels.height!==source.tileHeight ? 'size' : !origin.sourcePixelHash.includes('|') ? 'grid' : origin.sourcePixelHash.split('|')[1]!==pixelSourceGrid(source) ? 'gridChanged' : undefined;
    return {key:JSON.stringify([edited.id,tileId]),edited,tileId,source,sourceTileId:origin?.sourceTileId??-1,baseHash:origin?.sourcePixelHash??'',pixels,reason};
  }) : []);
}
export function variantGroups(variants: readonly PngVariant[], source: Tileset) {
  const groups = new Map<number,PngVariant[]>();
  for(const v of variants) if(!v.reason && v.source?.imagePath===source.imagePath && pixelSourceGrid(v.source)===pixelSourceGrid(source)) { const list=groups.get(v.sourceTileId)??[]; list.push(v); groups.set(v.sourceTileId,list); }
  return [...groups].sort(([a],[b])=>a-b).map(([tileId,list])=>({tileId,variants:list,choice:list.length===1?list[0]!.key:null}));
}
interface SourceSnapshot { readonly bytes:Uint8Array; readonly pixels:RasterImage; readonly grid:string }
export interface PngDraft {
  readonly ws: NonNullable<ReturnType<typeof getLevelWorkspace>>;
  readonly folder: NonNullable<ReturnType<typeof getProjectFolder>>;
  readonly historyVersion:number;
  readonly variants:readonly PngVariant[];
  readonly sources:readonly Tileset[];
  readonly source:Tileset|null;
  readonly snapshot:SourceSnapshot|null;
  readonly choices:Readonly<Record<number,string|null>>;
  readonly counts:Readonly<Record<string,number>>;
  readonly backupPath:string;
  readonly backups:readonly string[];
  readonly restore:string|null;
  readonly restoreBytes:Uint8Array|null;
  readonly rebased:boolean;
  readonly mode:'apply'|'restore';
}
interface PngState { draft:PngDraft|null; busy:boolean; writing:boolean; error:MessageKey|null; changed:boolean }
export const usePngWriteback=create<PngState>()(()=>({draft:null,busy:false,writing:false,error:null,changed:false}));
registerTilesetModal(()=>usePngWriteback.getState().draft!==null);
let requestVersion=0;
const refKey=(tilesetId:string,tileId:number)=>JSON.stringify([tilesetId,tileId]);
export const pngReasonKey=(reason:Reason):MessageKey=>`pngWriteback.${reason}`;
function changedError(error:unknown):boolean { return error instanceof PngChangedError || (typeof error==='object'&&error!==null&&'kind' in error&&error.kind==='Changed'); }
export function closePngWriteback():void { if(usePngWriteback.getState().writing)return; ++requestVersion;usePngWriteback.setState({draft:null,busy:false,error:null,changed:false}); }
export async function openPngWriteback(editedId?:string, mode:'apply'|'restore'='apply', sourceId?:string):Promise<void> {
  const ws=getLevelWorkspace(),folder=getProjectFolder(),store=useEditorStore.getState().project?.store;
  if(!ws||!folder||!store||usePngWriteback.getState().busy)return;
  const version=++requestVersion;
  const variants=collectPngVariants(store);
  const all=store.document.tilesets.filter(s=>!s.generated&&!s.edited&&!isSnapshotImagePath(s.imagePath)&&s.imagePath.startsWith('tilesets/')&&s.imagePath.toLowerCase().endsWith('.png'));
  const sources=all.filter((s,i)=>all.findIndex(a=>a.imagePath===s.imagePath)===i);
  const initial=sourceId ? sources.find(s=>s.imagePath===store.document.getTileset(sourceId)?.imagePath)??null : variants.find(v=>v.edited.id===editedId&&!v.reason)?.source??sources[0]??null;
  const draft:PngDraft={ws,folder,historyVersion:ws.history.version,variants,sources,source:initial,snapshot:null,choices:{},counts:{},backupPath:'',backups:[],restore:null,restoreBytes:null,rebased:false,mode};
  usePngWriteback.setState({draft,busy:true,error:null,changed:false});
  try {
    const targets=[...variants.map(v=>({tilesetId:v.edited.id,tileId:v.tileId})),...variants.flatMap(v=>v.source?[{tilesetId:v.source.id,tileId:v.sourceTileId}]:[])];
    const results=await scanWorldUsages({maps:ws.levels,cached:id=>ws.entry(id)?.store.document,scanFile:async(map,refs,signal)=>scanUsageFile(await folder.fs.readText(ws.level(map.id)!.path),refs,signal)},targets,new AbortController().signal);
    if(version!==requestVersion||getLevelWorkspace()!==ws||getProjectFolder()!==folder)return;
    const counts:Record<string,number>={}; for(const result of results) { const key=refKey(result.tilesetId,result.tileId);counts[key]=(counts[key]??0)+1; }
    usePngWriteback.setState({draft:{...draft,counts},busy:false});
    if(initial)await selectPngSource(initial.id);
  }catch { if(version===requestVersion)usePngWriteback.setState({busy:false,error:'pngWriteback.readFailed'}); }
}
export function pngTileBefore(draft:PngDraft,tileId:number):RasterImage|undefined {
  if(!draft.source||!draft.snapshot||tileId<0||tileId>=draft.source.columns*draft.source.rows)return;
  const {source,snapshot}=draft,rect=tileRect(source,tileId),image=snapshot.pixels;
  if(rect.x+rect.width>image.width||rect.y+rect.height>image.height)return;
  const data=new Uint8Array(rect.width*rect.height*4);
  for(let y=0;y<rect.height;y++)data.set(image.data.subarray(((rect.y+y)*image.width+rect.x)*4,((rect.y+y)*image.width+rect.x+rect.width)*4),y*rect.width*4);
  return {width:rect.width,height:rect.height,data,revision:0};
}
export function pngVariantChanged(draft:PngDraft,variant:PngVariant):boolean {
  const before=pngTileBefore(draft,variant.sourceTileId);
  return !before||!draft.source||variant.baseHash!==`${rasterContentHash(before.width,before.height,before.data)}|${pixelSourceGrid(draft.source)}`;
}
export async function selectPngSource(id:string,rebase=false):Promise<void> {
  const {draft}=usePngWriteback.getState(); if(!draft)return;
  const source=draft.sources.find(s=>s.id===id);if(!source)return;
  if (rebase && draft.ws.history.version!==draft.historyVersion) { await openPngWriteback(undefined,draft.mode,draft.source?.id); usePngWriteback.setState({changed:true}); return; }
  const version=++requestVersion;
  usePngWriteback.setState({busy:true,error:null,changed:false});
  try {
    // Reload is a new review/confirmation against current disk pixels; never retries a write.
    if(rebase)await reloadTilesetImage(source.imagePath);
    const bytes=await draft.folder.fs.readBytes(source.imagePath),pixels=decodeSourcePng(bytes),backups=await listPngBackups(draft.folder.fs,source.imagePath);
    if(version!==requestVersion||getLevelWorkspace()!==draft.ws||getProjectFolder()!==draft.folder)return;
    const fits = Math.floor((pixels.width-source.margin*2+source.spacing)/(source.tileWidth+source.spacing))===source.columns && Math.floor((pixels.height-source.margin*2+source.spacing)/(source.tileHeight+source.spacing))===source.rows;
    const choices:Record<number,string|null>={}; for(const group of variantGroups(draft.variants,source))choices[group.tileId]=group.choice;
    const next:PngDraft={...draft,source,snapshot:{bytes,pixels:{...pixels,data:new Uint8Array(pixels.data),revision:0},grid:pixelSourceGrid(source)},choices,backupPath:pngBackupPath(source.imagePath),backups,restore:null,restoreBytes:null,rebased:rebase&&fits};
    usePngWriteback.setState({draft:next,busy:false,changed:(!fits&&next.mode==='apply') || (!rebase&&next.mode==='apply'&&variantGroups(next.variants,source).some(g=>g.variants.some(v=>pngVariantChanged(next,v))))});
  }catch { if(version===requestVersion)usePngWriteback.setState({busy:false,error:'pngWriteback.readFailed'}); }
}
export function choosePngVariant(tileId:number,key:string|null):void { const {draft,busy}=usePngWriteback.getState();if(draft&&!busy)usePngWriteback.setState({draft:{...draft,choices:{...draft.choices,[tileId]:key}}}); }
export async function choosePngBackup(path:string):Promise<void> {
  const {draft,busy}=usePngWriteback.getState();if(!draft||busy||!draft.backups.includes(path))return;
  usePngWriteback.setState({busy:true,error:null});const version=++requestVersion;
  try { const bytes=await draft.folder.fs.readBytes(path);decodeSourcePng(bytes);if(version===requestVersion)usePngWriteback.setState({draft:{...draft,restore:path,restoreBytes:bytes},busy:false}); }
  catch { if(version===requestVersion)usePngWriteback.setState({busy:false,error:'pngWriteback.readFailed'}); }
}
export function pngCanConfirm(draft:PngDraft):boolean {
  if(!draft.source||!draft.snapshot)return false;
  if(draft.mode==='restore')return !!draft.restoreBytes;
  const groups=variantGroups(draft.variants,draft.source);
  return groups.length>0&&groups.every(g=>!!draft.choices[g.tileId])&&groups.some(g=>draft.choices[g.tileId]!=='skip');
}
export function pngUsageCount(draft:PngDraft,tilesetId:string,tileId:number):number { return draft.counts[refKey(tilesetId,tileId)]??0; }
export async function confirmPngWriteback():Promise<void> {
  const state=usePngWriteback.getState(),draft=state.draft;
  if(!draft||state.busy||state.changed||!pngCanConfirm(draft))return;
  usePngWriteback.setState({busy:true,writing:true,error:null});
  try {
    await withProjectWriteGate(async()=>{
      const source=draft.source!,snapshot=draft.snapshot!;
      const live=useEditorStore.getState().project?.store, liveSource=live?.document.getTileset(source.id);
      if(!liveSource||liveSource.imagePath!==source.imagePath||getLevelWorkspace()!==draft.ws||getProjectFolder()!==draft.folder||!live||draft.historyVersion!==draft.ws.history.version||pixelSourceGrid(liveSource)!==snapshot.grid)throw new PngChangedError();
      if(!equalPngBytes(await draft.folder.fs.readBytes(source.imagePath),snapshot.bytes))throw new PngChangedError();
      if(draft.mode==='restore')await restorePngBackup(draft.folder.fs,source.imagePath,draft.restore!,snapshot.bytes,draft.backupPath,draft.restoreBytes!);
      else {
        const variants=collectPngVariants(live),selected=Object.values(draft.choices).filter(k=>k&&k!=='skip').map(key=>draft.variants.find(v=>v.key===key)!);
        for(const v of selected) { const current=variants.find(c=>c.key===v.key); if(!current?.pixels||!v.pixels||!equalPngBytes(current.pixels.data,v.pixels.data)||current.baseHash!==v.baseHash||current.reason||current.source?.id!==v.source?.id||current.sourceTileId!==v.sourceTileId)throw new PngChangedError(); }
        const patches=selected.map(v=>{const before=pngTileBefore(draft,v.sourceTileId)!;return {tileId:v.sourceTileId,pixels:v.pixels!,baseHash:draft.rebased?`${rasterContentHash(before.width,before.height,before.data)}|${snapshot.grid}`:v.baseHash};});
        const plan=await preparePngPatch(draft.folder.fs,source,patches);
        if(!equalPngBytes(plan.expected,snapshot.bytes) || getLevelWorkspace()!==draft.ws || getProjectFolder()!==draft.folder || draft.ws.history.version!==draft.historyVersion || pixelSourceGrid(live.document.getTileset(source.id)!)!==snapshot.grid)throw new PngChangedError();
        await applyPngPatch(draft.folder.fs,{...plan,backupPath:draft.backupPath});
      }
      // Same byte/content-aware path as disk watching. A later equal-byte echo does nothing.
      await reloadTilesetImage(source.imagePath);
    });
    usePngWriteback.setState({busy:false,writing:false,draft:null});
    toast.success(t('pngWriteback.success'));
  }catch(error) { usePngWriteback.setState({busy:false,writing:false,error:changedError(error)?null:'pngWriteback.writeFailed',changed:changedError(error)}); }
}
export function registerPngWritebackCommands():void {
  const ready=()=>!!getProjectFolder()&&!!getLevelWorkspace()&&!useEditorStore.getState().project?.levelId?.startsWith('stamp:');
  registerCommands([
    {id:'pixel.applyPng',title:'pngWriteback.apply',category:'tileset',enabled:ready,run:()=>{void openPngWriteback();}},
    {id:'pixel.restorePng',title:'pngWriteback.restore',category:'tileset',enabled:ready,run:()=>{void openPngWriteback(undefined,'restore');}},
  ]);
}
