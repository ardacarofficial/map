/// <reference types="node" />

import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { roadPixels } from '../../editor/src/commands/roadPixels.testHelper';
import type { Stamp, Tileset } from '../../core/src/index';
import type { ToolHost } from '../../editor/src/canvas/toolController';
import type * as BakeModule from '../../editor/src/ui/stamps/smartStampBake';
import { serializeStamp, parseStamp, serializeLevel, applySmartStampRoad, roadMembership, normalizeProjectSettings } from '../../core/src/index';
import { browserPlatform, setPlatform, getPlatform } from '../../editor/src/platform/index';
import { newProject, addDecodedTilesets, autosaveNow, installSession, closeProject, getLevelWorkspace, openLevel, saveCurrentProject, openProjectFromPicker } from '../../editor/src/io/session';
import { reloadTilesetImage, installFileChangeHandling } from '../../editor/src/platform/fileChanges';
import { useEditorStore } from '../../editor/src/state/editorStore';
import { useProjectLibrary } from '../../editor/src/io/projectLibrary';
import { setTilesetImage, getTilesetImage, deferredTilesetImage } from '../../editor/src/state/tilesetImages';
import { waitForSelectionBrush, autoBrush, publishBrushAssets } from '../../editor/src/commands/smartBrushActions';
import { prepareSmartStamp, acceptSmartStamp, installSmartStamps, waitForSmartStampRegeneration } from '../../editor/src/commands/smartStampCommands';
import { saveClipAsStamp } from '../../editor/src/ui/tileset/SelectionSection';
import { commitTilesetSelection } from '../../editor/src/ui/tileset/tilesetSelect';
import { useToastStore } from '../../editor/src/ui/toast/toastStore';
import { bakeSmartStamp } from '../../editor/src/ui/stamps/smartStampBake';
import { remedyBrushGrid, adoptMapGrid } from '../../editor/src/commands/smartBrushGrid';
import { createLevel, useLevelUi, openNewLevelDialog } from '../../editor/src/commands/levelActions';
import { FileNotFoundError } from '../../editor/src/io/fs';
/* Baseline reproduction evidence (36cd32b / v0.12.0), before these fixed-behavior assertions:
 * - source16/map32 never called bakeSmartStamp; waiting/saving reported
 *   "Hazırlanamadı: Error: Stamp veya proje değişti. Yeniden hazırlayın."
 *   instead of core's "missing or incompatible source tile reference".
 * - stampDrawList used 32 px destinations for 16 px tiles (16 px gaps).
 * - equal PNG-byte wrappers and a library rename both rejected acceptance.
 * - carrying a ready native16 brush to map32 produced the same changed toast.
 * - successful matching-grid inline saves already preserved nineSlice through
 *   autosave and serialization; a successful-save-to-plain loss was not reproduced.
 * The adapter is real; mocked invoke/listen and bitmap boundaries are not a
 * substitute for an installed Windows/WebView2 run.
 */
// Only raster/bitmap boundary is mocked. Core validation, selection, jobs, session, save, watcher and stamp IO are real.
vi.mock('../../editor/src/state/tilesetPixels',()=>({tilesetPixels:(_bitmap:ImageBitmap,rect:{x:number;y:number;width:number;height:number})=>roadPixels(rect)}));
vi.mock('../../editor/src/ui/stamps/smartStampBake',async original=>({...await original<typeof BakeModule>(),bakeSmartStamp:vi.fn(async (_s:Stamp,_l:string,t:Tileset)=>({tilesetId:t.id,bytes:png,bitmap:bitmap()}))}));
const png=Uint8Array.of(137,80,78,71,13,10,26,10,0); // Signature accepted; decoder is mocked, never passed to an engine.
const bitmap=()=>({width:96,height:96,close:vi.fn()}) as unknown as ImageBitmap;
let root:string;
let cb:((event:{payload:{path:string;kind:string}})=>void)|undefined;
let stops:(()=>void)[]=[];
const fs={name:'Windows equivalent',async mkdir(p:string){await mkdir(join(root,p),{recursive:true});},async readBytes(p:string){try{return new Uint8Array(await readFile(join(root,p)));}catch{throw new FileNotFoundError(p);}},async readText(p:string){return new TextDecoder().decode(await this.readBytes(p));},async writeBytes(p:string,b:Uint8Array){await mkdir(dirname(join(root,p)),{recursive:true});await writeFile(join(root,p),b);},async writeText(p:string,s:string){await this.writeBytes(p,new TextEncoder().encode(s));},async list(p:string){try{return await readdir(join(root,p));}catch{return[];}},async remove(p:string){try{await unlink(join(root,p));}catch{/* Already absent. */}}};
// Real desktop platform and TauriFileSystem; only Rust invoke/listen are replaced.
vi.mock('@smap/editor',async()=>({...await import('../../editor/src/platform/types'),...await import('../../editor/src/io/fs')}));
vi.mock('@tauri-apps/api/core',()=>({invoke:async(command:string,args:Record<string,unknown>|Uint8Array={},options:{headers?:Record<string,string>}={})=>{
 await new Promise(r=>setTimeout(r,[0,2,5][tick++%3]));
 const fields=args as Record<string,unknown>;
 const abs=options?.headers?.['x-smap-path']?decodeURIComponent(options.headers['x-smap-path']):fields.path as string|undefined;
 const rel=abs?.replaceAll('\\','/').replace('C:/Maps/Dunya/','')??'';
 switch(command){
 case 'settings_path':return 'C:/Config/settings.json';case 'project_set_root':return winRoot;
 case 'read_text':return fs.readText(rel);case 'write_text_atomic':return fs.writeText(rel,fields.text as string);
 case 'read_file':return (await fs.readBytes(rel)).buffer;
 case 'write_file_atomic':return fs.writeBytes(rel,args as Uint8Array);
 case 'create_dir_all':return fs.mkdir(rel);case 'list_dir':return fs.list(rel);case 'remove_file':return fs.remove(rel);
 case 'recent_list':return [];default:return null;
 }
}}));
vi.mock('@tauri-apps/api/webviewWindow',()=>({getCurrentWebviewWindow:()=>({listen:async(name:string,fn:(event:{payload:{path:string;kind:string}})=>void)=>{if(name==='smap://file-changed')cb=fn;return()=>{};}})}));
const {createDesktopPlatform}=await import('./desktopPlatform');
const {TauriFileSystem}=await import('./tauriFileSystem');
const winRoot='C:/Maps/Dunya';let tick=0;
const target={fs:new TauriFileSystem(winRoot),ref:winRoot,label:winRoot};
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),"smap-smart-desktop-"));
 const storage=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});
 vi.stubGlobal('window',{addEventListener(){},removeEventListener(){}});
 vi.stubGlobal('document',{addEventListener(){},removeEventListener(){},documentElement:{lang:'tr'}});
 vi.stubGlobal('createImageBitmap',async()=>bitmap());
 // Persistence integration recreates one renderer in this process; native
 // world-window delegation is covered separately by multiWorldWindows.test.
 const platform=createDesktopPlatform();delete platform.openWorldWindow;setPlatform(platform);
 stops=[installSession(),installFileChangeHandling()];installSmartStamps();
 useToastStore.setState({toasts:[]});vi.mocked(bakeSmartStamp).mockClear();
});
afterEach(async()=>{await waitForSmartStampRegeneration();stops.forEach(s=>s());closeProject();vi.unstubAllGlobals();setPlatform(browserPlatform);await rm(root,{recursive:true,force:true});});
async function setup(mapSize=32,tileSize=32){
 await newProject({name:'Desktop repro',width:24,height:20,tileSize:mapSize,folder:target});
 const store=useEditorStore.getState().project!.store;
 const [ts]=addDecodedTilesets(store,[{name:'Road',png:{file:{name:'road.png'} as File,bytes:png,bitmap:bitmap()},spec:{tileWidth:tileSize,tileHeight:tileSize,margin:0,spacing:0}}]);
 await autosaveNow();
 const ids=Array.from({length:9},(_,i)=>Math.floor(i/3)*ts!.columns+i%3);
 commitTilesetSelection(ts!,ids,{anchor:{col:0,row:0},focus:{col:2,row:2}},new Set());
 return {store,ts:ts!,clip:useEditorStore.getState().stamp!,ids};
}
it('16px source / 32px map: explicit unavailable state before bake, no permanent pending or raw toast',async()=>{
 const {clip}=await setup(32,16);
 await expect(waitForSelectionBrush(clip)).resolves.toBeUndefined();
 expect(autoBrush(clip)?.state.status).toBe('unavailable');
 expect(vi.mocked(bakeSmartStamp)).not.toHaveBeenCalled();
 expect(useToastStore.getState().toasts).toHaveLength(0);
});
it('matching grid: actual autosave + own PNG watcher event retains image identity and smart stamp survives serialization',async()=>{
 const {store,clip,ts}=await setup();await waitForSelectionBrush(clip);
 const image=getTilesetImage(ts.id),saved=await saveClipAsStamp(store.document,clip,'Road');
 expect(saved?.nineSlice?.road).toBeDefined();
 await autosaveNow();cb!({payload:{path:winRoot+'/'+ts.imagePath,kind:'modified'}});await reloadTilesetImage(ts.imagePath);
 expect(getTilesetImage(ts.id)).toBe(image);
 expect(parseStamp(serializeStamp(saved!)).nineSlice).toEqual(saved!.nineSlice);
 expect(useProjectLibrary.getState().stamps[0]).toBe(saved);
});
it('equal-byte image object replacement retains valid prepared library stamp',async()=>{
 const {clip,ts}=await setup();const p=(await waitForSelectionBrush(clip))!;
 // Direct canonical recipe is not in the library. Isolate the library acceptance guard with that exact source object.
 useProjectLibrary.getState().addStamp(p.source);
 setTilesetImage({tilesetId:ts.id,bytes:png.slice(),bitmap:bitmap()});
 expect(()=>acceptSmartStamp(p)).not.toThrow();
});
it('metadata-only rename retains prepared library recipe',async()=>{
 const {clip}=await setup();const p=(await waitForSelectionBrush(clip))!;
 useProjectLibrary.getState().addStamp(p.source);
 const q=await prepareSmartStamp(p.source);useProjectLibrary.getState().renameStamp(q.source.id,'Rename');
 expect(()=>acceptSmartStamp(q)).not.toThrow();
});

it('ready native16 brush carried into map32 becomes unavailable without a generic toast',async()=>{
 const {clip}=await setup(16,16);await waitForSelectionBrush(clip);
 const ws=getLevelWorkspace()!;
 const level=ws.add({name:'Second map 32',width:24,height:20,tileSize:32,layerName:'Ground'});
 expect(await openLevel(level.id)).toBe(true);
 expect(useEditorStore.getState().stamp).toBe(clip);
 const store=useEditorStore.getState().project!.store;
 const {ToolController}=await import('../../editor/src/canvas/toolController');
 const controller=new ToolController({scene:{store},entities:{},camera:{cellAt:()=>({x:4,y:4})},toLocal:()=>({x:0,y:0}),pointerCell:()=>({x:4,y:4}),capture(){},release(){},requestRender(){}} as unknown as ToolHost);
 controller.pointerDown({button:0,pointerId:1,preventDefault(){},shiftKey:false,altKey:false} as unknown as PointerEvent,{x:4,y:4});
 expect(useToastStore.getState().toasts).toHaveLength(0);
 controller.cancel();expect(store.inTransaction).toBe(false);expect(store.document.tilesets.filter(t=>t.generated)).toHaveLength(0);
}, 60_000);

it('real folder: autosaved road, recipe ids, source bytes and Save As survive reopening',async()=>{
 const {store,clip,ts}=await setup();const prepared=(await waitForSelectionBrush(clip))!;
 const saved=(await saveClipAsStamp(store.document,clip,'Road'))!;
 store.beginTransaction();publishBrushAssets(saved,store);
 applySmartStampRoad(store,prepared.stamp,store.document.layers[0]!.id,roadMembership([{x:4,y:4},{x:5,y:4},{x:6,y:4}]));store.commit();
 await autosaveNow();
 expect(await fs.readBytes(ts.imagePath)).toEqual(png);
 const stampFile=JSON.parse(await fs.readText('stamps/road.json'));
 expect(stampFile.nineSlice).toEqual(saved.nineSlice);
 const bank=store.document.tilesets.find(t=>t.generated)!;
 expect(JSON.parse(await fs.readText(`tilesets/${bank.id}.recipe.json`)).id).toBe(bank.generated!.stampId);
 const before=serializeLevel(store.document),copy={fs:new TauriFileSystem(winRoot+'/copy'),ref:winRoot+'/copy',label:'copy'};
 vi.spyOn(getPlatform(),'pickProjectFolder').mockResolvedValueOnce(copy);
 expect(await saveCurrentProject(true)).toBe(true);expect(await fs.readBytes('copy/'+ts.imagePath)).toEqual(png);
 closeProject();vi.spyOn(getPlatform(),'openProjectDialog').mockResolvedValueOnce(copy);await openProjectFromPicker();
 expect(serializeLevel(useEditorStore.getState().project!.store.document)).toBe(before);
 expect(useProjectLibrary.getState().stamps[0]!.nineSlice).toEqual(saved.nineSlice);
 expect(useProjectLibrary.getState().generatedRecipes[0]!.stamp.id).toBe(bank.generated!.stampId);
});
it('folder chosen at first save publishes an unused smart library brush, with jitter and autosave enabled',async()=>{
 await newProject({name:'First save',width:24,height:20,tileSize:32});
 const store=useEditorStore.getState().project!.store;
 const [ts]=addDecodedTilesets(store,[{name:'Road',png:{file:{name:'road.png'} as File,bytes:png,bitmap:bitmap()},spec:{tileWidth:32,tileHeight:32,margin:0,spacing:0}}]);
 commitTilesetSelection(ts!,[0,1,2,3,4,5,6,7,8],{anchor:{col:0,row:0},focus:{col:2,row:2}},new Set());
 const clip=useEditorStore.getState().stamp!;await waitForSelectionBrush(clip);const saved=(await saveClipAsStamp(store.document,clip,'Road'))!;
 vi.spyOn(getPlatform(),'pickProjectFolder').mockResolvedValueOnce(target);expect(await saveCurrentProject(false)).toBe(true);
 expect(JSON.parse(await fs.readText('stamps/road.json')).nineSlice).toEqual(saved.nineSlice);
 expect(await fs.readBytes(ts!.imagePath)).toEqual(png);expect(store.document.tilesets.filter(t=>t.generated)).toHaveLength(1);
},15_000);

for(const thumbnailPending of [false,true])it(`autosave waits for deferred encoding while a real stroke commits (thumbnail pending=${thumbnailPending})`,async()=>{
 let release!:(bytes:Uint8Array)=>void,entered!:()=>void;
 const encoding=new Promise<Uint8Array>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 vi.mocked(bakeSmartStamp).mockImplementationOnce((_stamp,_layer,tileset)=>deferredTilesetImage(tileset.id,bitmap(),()=>{entered();return encoding;}));
 const {store,clip,ts}=await setup();const prepared=(await waitForSelectionBrush(clip))!;
 const {thumbnailSnapshots}=await import('../../editor/src/canvas/thumbnailSnapshotBridge');
 const snapshot=vi.fn(()=>({width:1,height:1,data:Uint8ClampedArray.of(0,0,0,0)}));
 const stop=thumbnailSnapshots.register({state:()=>{const project=useEditorStore.getState().project!;return {project,level:project.levelId??project.levelPath,revision:store.revision,version:1,pending:thumbnailPending};},snapshot});
 try{
  const saved=(await saveClipAsStamp(store.document,clip,'Road'))!;
  const saving=autosaveNow();await started;expect(store.inTransaction).toBe(false);
  store.beginTransaction();publishBrushAssets(saved,store);
  applySmartStampRoad(store,prepared.stamp,store.document.layers[0]!.id,roadMembership([{x:4,y:4},{x:5,y:4},{x:6,y:4}]));store.commit();
  release(png);await saving;await autosaveNow();
  if(!thumbnailPending)await vi.waitFor(()=>expect(snapshot).toHaveBeenCalled(),{timeout:10000});
  else expect(snapshot).not.toHaveBeenCalled();
  expect(await fs.readBytes(ts.imagePath)).toEqual(png);
  const {parseLevel}=await import('../../core/src/index');
  const loaded=parseLevel(await fs.readText('levels/main.json'),store.document.tilesets);
  expect([4,5,6].map(x=>loaded.layers[0]!.getCell(x,4))).not.toContain(0);
  expect(JSON.parse(await fs.readText('stamps/road.json')).nineSlice).toEqual(saved.nineSlice);
  expect((await waitForSelectionBrush(saved))!.sources).toEqual(prepared.sources);
 }finally{release(png);stop();}
},20_000);
it('a watched source revision after undo reparses automatically with the same reserved bank and saved recipe',async()=>{
 const {store,clip,ts}=await setup();const first=(await waitForSelectionBrush(clip))!,bankId=first.assets[0]!.tileset.id;
 const saved=(await saveClipAsStamp(store.document,clip,'Road'))!;
 const paint=()=>{store.beginTransaction();publishBrushAssets(saved,store);applySmartStampRoad(store,autoBrush(saved)!.prepared!.stamp,store.document.layers[0]!.id,roadMembership([{x:4,y:4},{x:5,y:4}]));store.commit();};
 paint();store.undo();expect(store.document.getTileset(bankId)).toBeUndefined();
 const updated=png.slice();updated[8]=1;await fs.writeBytes(ts.imagePath,updated);await reloadTilesetImage(ts.imagePath);
 const next=(await waitForSelectionBrush(saved))!;expect(next.assets[0]!.tileset.id).toBe(bankId);expect(next.sources).not.toEqual(first.sources);
 paint();await autosaveNow();expect(await fs.readBytes(ts.imagePath)).toEqual(updated);
 expect(JSON.parse(await fs.readText('stamps/road.json')).nineSlice.road.tilesetId).toBe(bankId);
 expect(useToastStore.getState().toasts.filter(t=>t.kind==='error')).toHaveLength(0);
},20_000);

it('saves an unused native16 library brush while map32 is active without losing its generated assets',async()=>{
 const {store,clip}=await setup(16,16);await waitForSelectionBrush(clip);
 const saved=(await saveClipAsStamp(store.document,clip,'Road'))!,bankId=saved.nineSlice!.road!.tilesetId;
 const level=getLevelWorkspace()!.add({name:'Map32',width:24,height:20,tileSize:32,layerName:'Ground'});expect(await openLevel(level.id)).toBe(true);
 await autosaveNow();
 const project=JSON.parse(await fs.readText('project.smap'));expect(project.tilesets.some((t:Tileset)=>t.id===bankId&&t.tileWidth===16)).toBe(true);
 expect(JSON.parse(await fs.readText('stamps/road.json')).nineSlice).toEqual(saved.nineSlice);
 expect(await fs.readBytes(`tilesets/${bankId}.png`)).toEqual(png);
 expect(useToastStore.getState().toasts.filter(t=>t.kind==='error')).toHaveLength(0);
},20_000);

it('regenerates a published native16 bank while map32 is active, keeping painting unavailable there',async()=>{
 const {store,clip,ts}=await setup(16,16);const prepared=(await waitForSelectionBrush(clip))!,bankId=prepared.assets[0]!.tileset.id;
 const saved=(await saveClipAsStamp(store.document,clip,'Road'))!;
 store.beginTransaction();publishBrushAssets(saved,store);applySmartStampRoad(store,prepared.stamp,store.document.layers[0]!.id,roadMembership([{x:4,y:4},{x:5,y:4}]));store.commit();
 const ws=getLevelWorkspace()!,oldLevel=ws.activeId,level=ws.add({name:'Map32',width:24,height:20,tileSize:32,layerName:'Ground'});expect(await openLevel(level.id)).toBe(true);
 const updated=png.slice();updated[8]=2;await fs.writeBytes(ts.imagePath,updated);await reloadTilesetImage(ts.imagePath);await waitForSmartStampRegeneration();await autosaveNow();
 const {pngHash}=await import('../../editor/src/state/pngHash');
 const project=JSON.parse(await fs.readText('project.smap')),bank=project.tilesets.find((t:Tileset)=>t.id===bankId);
 expect(bank.tileWidth).toBe(16);expect(bank.generated.sources[0].imageHash).toBe(await pngHash(updated));
 await expect(waitForSelectionBrush(saved)).resolves.toBeUndefined();
 expect(useToastStore.getState().toasts.filter(t=>t.kind==='error')).toHaveLength(0);
 expect(await openLevel(oldLevel)).toBe(true);await waitForSelectionBrush(saved);
 expect(useEditorStore.getState().project!.store.document.layers[0]!.getCell(4,4)).not.toBe(0);
},20_000);

// Review #1: a source grid is an explicit override, independent of future-map defaults.
it.each([{ tileWidth: 16, tileHeight: 16 }, { tileWidth: 16, tileHeight: 24 }])('new-map remedy preserves source $tileWidth × $tileHeight with rectangular world defaults', async grid => {
 await newProject({name:'Rectangular defaults',width:24,height:20,tileSize:32,folder:target,settings:normalizeProjectSettings({tileWidth:16,tileHeight:grid.tileHeight===16?24:32})});
 const store=useEditorStore.getState().project!.store;
 const [ts]=addDecodedTilesets(store,[{name:'Road',png:{file:{name:'road.png'} as File,bytes:png,bitmap:bitmap()},spec:{...grid,margin:0,spacing:0}}]);
 const ids=Array.from({length:9},(_,i)=>Math.floor(i/3)*ts!.columns+i%3);
 commitTilesetSelection(ts!,ids,{anchor:{col:0,row:0},focus:{col:2,row:2}},new Set());
 const clip=useEditorStore.getState().stamp!;
 store.dispatch({type:'paintCells',layerId:store.document.layers[0]!.id,cells:[{x:0,y:0,cell:store.getOrAddPaletteIndex(ts!.id,0)}]});
 remedyBrushGrid();
 expect(useLevelUi.getState().newLevelGrid).toEqual(grid);
 expect(await createLevel({name:'Remedy',width:24,height:20,...useLevelUi.getState().newLevelGrid!})).toBe(true);
 openNewLevelDialog(false);
 const active=useEditorStore.getState().project!.store;
 expect(active.document.map).toMatchObject(grid);
 expect(useEditorStore.getState().stamp).toBe(clip);
 expect(await waitForSelectionBrush(clip)).toBeDefined();
 const {ToolController}=await import('../../editor/src/canvas/toolController');
 const controller=new ToolController({scene:{store:active},entities:{},camera:{cellAt:()=>({x:4,y:4})},toLocal:()=>({x:0,y:0}),pointerCell:()=>({x:4,y:4}),capture(){},release(){},requestRender(){}} as unknown as ToolHost);
 controller.pointerDown({button:0,buttons:1,pointerId:77,preventDefault(){},shiftKey:false,altKey:false} as unknown as PointerEvent,{x:4,y:4});
 controller.pointerUp({button:0,buttons:0,pointerId:77,preventDefault(){},shiftKey:false,altKey:false} as unknown as PointerEvent);
 expect(active.document.tilesets.filter(t=>t.generated)).toHaveLength(1);
 expect(active.document.palette.get(active.document.layers[0]!.getCell(4,4)&0x1fffffff)!.tilesetId).not.toBe(ts!.id);
 controller.cancel();
},60_000);
it('ordinary new maps retain world defaults; adopting an empty map replaces both dimensions',async()=>{
 const {store,ts}=await setup(32,16);
 useProjectLibrary.setState({settings:normalizeProjectSettings({tileWidth:16,tileHeight:24})});
 store.dispatch({type:'resizeMap',width:24,height:20,tileWidth:16,tileHeight:24});
 adoptMapGrid(store,ts);expect(store.document.map).toMatchObject({tileWidth:16,tileHeight:16});
 expect(await createLevel({name:'Ordinary',width:24,height:20,tileSize:16})).toBe(true);
 expect(useEditorStore.getState().project!.store.document.map).toMatchObject({tileWidth:16,tileHeight:24});
});
