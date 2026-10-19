import { roadPixels } from "./roadPixels.testHelper";
import type * as BakeModule from "../ui/stamps/smartStampBake";
import { beforeEach, expect, it, vi } from "vitest";
import { clipFromTileset, createDocument, MapStore, serializeLevel, type Stamp, type Tileset } from "@smap/core";
import { useEditorStore } from "../state/editorStore";
import { clearTilesetImages, setTilesetImage, tilesetSourceVersion } from "../state/tilesetImages";
import { useProjectLibrary } from "../io/projectLibrary";
import { prepareSelectionBrush, preparedBrush, publishBrushAssets, publishSavedBrushAssets, waitForSelectionBrush, setBrushSmartEnabled, brushDisabled, autoBrush } from "./smartBrushActions";
import { useSmartStampSession } from "../ui/stamps/smartStampSession";
import { saveClipAsStamp } from "../ui/tileset/SelectionSection";
import { bakeSmartStamp } from "../ui/stamps/smartStampBake";
import { tilesetPixels } from "../state/tilesetPixels";
import { decodePng } from "../../../core/test/png";
vi.mock("../state/tilesetPixels",()=>({tilesetPixels:vi.fn((_bitmap:ImageBitmap,rect:{x:number;y:number;width:number;height:number})=>roadPixels(rect))}));
vi.mock("../ui/stamps/smartStampBake",async importOriginal=>({...await importOriginal<typeof BakeModule>(),bakeSmartStamp:vi.fn(async(_s:Stamp,_l:string,t:Tileset)=>({tilesetId:t.id,bytes:Uint8Array.of(1),bitmap:{close:vi.fn()} as unknown as ImageBitmap}))}));
const source:Tileset={id:"source",name:"Source",imagePath:"tilesets/source.png",columns:12,rows:8,tileWidth:32,tileHeight:32,margin:0,spacing:0};
function setup(){
 const store=new MapStore(createDocument({width:24,height:20,tilesets:[source]}));const layerId=store.dispatch({type:"addLayer",layer:{name:"Ground"}});store.clearHistory();
 useEditorStore.getState().setProject({name:"Test",store,levelPath:"levels/main.json"});useEditorStore.getState().setActiveLayer(layerId);useEditorStore.getState().setTool("brush");
 useProjectLibrary.getState().load({stamps:[],levels:[]});setTilesetImage({tilesetId:source.id,bytes:Uint8Array.of(1),bitmap:{close:vi.fn()} as unknown as ImageBitmap});
 const clip=clipFromTileset(source,{x:2,y:1,w:3,h:3},{layerId})!;const ids=[14,15,16,26,27,28,38,39,40];
 prepareSelectionBrush(source,ids,new Set(),clip);useEditorStore.getState().setStamp(clip);return{store,clip,ids};
}
beforeEach(()=>{clearTilesetImages();vi.mocked(bakeSmartStamp).mockClear();vi.mocked(tilesetPixels).mockReset().mockImplementation((_bitmap,rect)=>roadPixels(rect!));});
it.each([[3,3],[5,4],[7,6]])("forces an object %i×%i to b=1, remembers reselection, saves and reloads using existing metadata",async(width,height)=>{
 const {store}=setup();await waitForSelectionBrush(useEditorStore.getState().stamp!);
 // The real 3×3 bush and larger ambiguous flat blocks have no cached road classification.
 const object={...source,id:"object"};store.dispatch({type:"addTileset",tileset:object});
 setTilesetImage({tilesetId:object.id,bytes:Uint8Array.of(1),bitmap:{close:vi.fn()} as unknown as ImageBitmap});
 const select=()=>{
  const clip=clipFromTileset(object,{x:2,y:1,w:width,h:height})!;
  vi.mocked(tilesetPixels).mockImplementation((_bitmap,rect)=>{
   const p=roadPixels(rect);
   if(width===3&&height===3)p.data.set(decodePng(readFileSync(new URL("../../../../e2e/fixtures/smart-object-32-bush.png",import.meta.url))).data);
   else{p.data.fill(128);for(let i=3;i<p.data.length;i+=4)p.data[i]=255;}
   return p;
  });
  prepareSelectionBrush(object,Array.from({length:width*height},(_,i)=>(1+Math.floor(i/width))*12+2+i%width),new Set(),clip);useEditorStore.getState().setStamp(clip);return clip;
 };
 const clip=select();expect(autoBrush(clip)).toBeUndefined();
 setBrushSmartEnabled(true);const forced=useEditorStore.getState().stamp!;
 const prepared=await waitForSelectionBrush(forced);expect(prepared?.stamp.nineSlice?.border).toBe(1);expect(prepared?.stamp.nineSlice?.road).toBeDefined();expect(brushDisabled(forced)).toBe(false);
 const again=select();await waitForSelectionBrush(again);expect(brushDisabled(again)).toBe(false);expect(preparedBrush(again)?.id).toBe(prepared?.stamp.id);
 const saved=(await saveClipAsStamp(store.document,again,"Forced path"))!;
 const {serializeStamp,parseStamp}=await import("@smap/core");const reopened=parseStamp(serializeStamp(saved));
 expect(reopened.nineSlice?.road).toBeDefined();expect(reopened.smartDisabled).not.toBe(true);
 useProjectLibrary.getState().load({stamps:[reopened],levels:[]});useEditorStore.getState().setStamp(reopened);expect(brushDisabled(reopened)).toBe(false);
 setBrushSmartEnabled(false);expect(brushDisabled(useEditorStore.getState().stamp)).toBe(true);expect(useProjectLibrary.getState().stamps[0]!.smartDisabled).toBe(true);
});
it("forcing an already saved plain object updates its saved recipe without another save-as",async()=>{
 const {clip,store}=setup();await waitForSelectionBrush(clip);
 const plain=clipFromTileset(source,{x:3,y:1,w:3,h:3})!;
 const ids=[15,16,17,27,28,29,39,40,41];
 vi.mocked(tilesetPixels).mockImplementation((_bitmap,rect)=>{const p=roadPixels(rect);p.data.fill(128);return p;});
 prepareSelectionBrush(source,ids,new Set(),plain);useEditorStore.getState().setStamp(plain);
 const saved=(await saveClipAsStamp(store.document,plain,"Object"))!;expect(saved.nineSlice).toBeUndefined();
 setBrushSmartEnabled(true);await waitForSelectionBrush(useEditorStore.getState().stamp!);
 expect(useProjectLibrary.getState().stamps[0]!.nineSlice?.road).toBeDefined();
});
it("small or incomplete source rectangles and grid mismatches cannot be forced",async()=>{
 const {store}=setup();await waitForSelectionBrush(useEditorStore.getState().stamp!);
 const {brushCanEnable}=await import("./smartBrushActions");
 for(const [w,h,hole]of [[2,2,false],[2,4,false],[4,2,false],[3,3,true]]as const){
  const ids=Array.from({length:w*h},(_,i)=>(1+Math.floor(i/w))*12+2+i%w),empty=new Set(hole?[ids[4]!]:[]);
  const clip=clipFromTileset(source,{x:2,y:1,w,h},{skipTileIds:empty})!;prepareSelectionBrush(source,ids,empty,clip);useEditorStore.getState().setStamp(clip);
  expect(brushCanEnable(clip)).toBe(false);setBrushSmartEnabled(true);expect(autoBrush(clip)).toBeUndefined();
 }
 const clip=clipFromTileset(source,{x:3,y:1,w:3,h:3})!;prepareSelectionBrush(source,[15,16,17,27,28,29,39,40,41],new Set(),clip);useEditorStore.getState().setStamp(clip);await waitForSelectionBrush(clip);
 store.dispatch({type:"resizeMap",width:24,height:20,tileWidth:16,tileHeight:16});setBrushSmartEnabled(true);expect(brushDisabled(clip)).toBe(true);
});
it("a plain flip before forcing has a distinct recipe and cannot poison an unflipped reselection",async()=>{
 const {clip}=setup();await waitForSelectionBrush(clip);
 vi.mocked(tilesetPixels).mockImplementation((_bitmap,rect)=>{const p=roadPixels(rect);p.data.fill(128);return p;});
 const plain=clipFromTileset(source,{x:3,y:1,w:3,h:3})!,ids=[15,16,17,27,28,29,39,40,41];
 prepareSelectionBrush(source,ids,new Set(),plain);useEditorStore.getState().setStamp(plain);
 const {flipBrush}=await import("./rotateCommands");const {cellFlags,FLIP_H}=await import("@smap/core");
 flipBrush("x");setBrushSmartEnabled(true);const flipped=(await waitForSelectionBrush(useEditorStore.getState().stamp!))!;
 expect([...flipped.source.layers[0]!.cells].every(c=>cellFlags(c)===FLIP_H)).toBe(true);
 const next=clipFromTileset(source,{x:3,y:1,w:3,h:3})!;prepareSelectionBrush(source,ids,new Set(),next);useEditorStore.getState().setStamp(next);setBrushSmartEnabled(true);
 const normal=(await waitForSelectionBrush(useEditorStore.getState().stamp!))!;
 expect([...normal.source.layers[0]!.cells].every(c=>cellFlags(c)===0)).toBe(true);expect(normal.source.id).not.toBe(flipped.source.id);
});
it("prepares without dirtying history/library, caches the recipe, and archives only a committed publication",async()=>{
 const {store,clip,ids}=setup(),before=serializeLevel(store.document),revision=useProjectLibrary.getState().revision;
 await waitForSelectionBrush(clip);expect(useEditorStore.getState().stamp).toBe(clip);expect(preparedBrush(clip)?.nineSlice?.road).toBeDefined();expect(store.undoDepth).toBe(0);expect(serializeLevel(store.document)).toBe(before);expect(useProjectLibrary.getState().revision).toBe(revision);expect(useProjectLibrary.getState().stamps).toHaveLength(0);
 const second=clipFromTileset(source,{x:2,y:1,w:3,h:3})!;prepareSelectionBrush(source,ids,new Set(),second);await waitForSelectionBrush(second);expect(vi.mocked(bakeSmartStamp)).toHaveBeenCalledTimes(1);expect(preparedBrush(second)?.id).toBe(preparedBrush(clip)?.id);
 store.beginTransaction();publishBrushAssets(clip,store);store.rollback();expect(store.document.tilesets).toHaveLength(1);expect(useProjectLibrary.getState().generatedRecipes).toHaveLength(0);
 store.beginTransaction();publishBrushAssets(clip,store);store.commit();expect(store.undoDepth).toBe(1);expect(useProjectLibrary.getState().generatedRecipes).toHaveLength(1);store.undo();expect(store.document.tilesets).toHaveLength(1);store.redo();expect(store.document.tilesets).toHaveLength(2);
});
it("saves the same prepared selection, keeps off metadata, and defaults B road/R area with separate overrides",async()=>{
 const {store,clip}=setup();await waitForSelectionBrush(clip);expect(useSmartStampSession.getState().usage).toBe("road");
 useEditorStore.getState().setTool("rect");expect(useSmartStampSession.getState().usage).toBe("area");useSmartStampSession.getState().setUsage("road");useEditorStore.getState().setTool("brush");expect(useSmartStampSession.getState().usage).toBe("road");useSmartStampSession.getState().setUsage("area");useEditorStore.getState().setTool("rect");expect(useSmartStampSession.getState().usage).toBe("road");
 setBrushSmartEnabled(false);const off=useEditorStore.getState().stamp!;expect(brushDisabled(off)).toBe(true);
 const stamp=await saveClipAsStamp(store.document,off,"Road");expect(stamp?.smartDisabled).toBe(true);expect(stamp?.nineSlice).toEqual(preparedBrush(clip)?.nineSlice);expect(autoBrush(stamp!)).toBe(autoBrush(clip));expect(store.document.tilesets).toHaveLength(1);
});
it("late async preparation cannot replace another brush or publish into a closed project",async()=>{
 let release!:(v:Awaited<ReturnType<typeof bakeSmartStamp>>)=>void;
 vi.mocked(bakeSmartStamp).mockImplementationOnce(()=>new Promise(r=>{release=r;}));
 const {store,clip}=setup();await vi.waitFor(()=>expect(release).toBeTypeOf("function"),{timeout:4000});
 useEditorStore.getState().setStamp(null);
 release({tilesetId:"late",bytes:new Uint8Array(),bitmap:{close:vi.fn()} as unknown as ImageBitmap});await waitForSelectionBrush(clip);expect(useEditorStore.getState().stamp).toBeNull();expect(store.document.tilesets).toHaveLength(1);expect(useProjectLibrary.getState().stamps).toHaveLength(0);
});
it("publishes an unused saved brush when saving from another level in the same project",async()=>{
 const {store,clip}=setup();await waitForSelectionBrush(clip);await saveClipAsStamp(store.document,useEditorStore.getState().stamp!,"Road");
 const other=new MapStore(createDocument({width:24,height:20,tilesets:[source]}));other.dispatch({type:"addLayer",layer:{name:"Ground"}});other.clearHistory();
 useEditorStore.getState().setProject({name:"Test",store:other,levelPath:"levels/other.json"});
 const {publishSavedBrushAssets}=await import("./smartBrushActions");
 await publishSavedBrushAssets();expect(other.document.tilesets.filter(t=>t.generated)).toHaveLength(1);
});
it("invalidates unpublished PNGs and keeps the same reserved atlas id before the first gesture",async()=>{
 const {clip,store}=setup();const first=await waitForSelectionBrush(clip),id=first!.assets[0]!.tileset.id;
 const image={tilesetId:source.id,bytes:Uint8Array.of(2),bitmap:{close:vi.fn()} as unknown as ImageBitmap};setTilesetImage(image);
 await vi.waitFor(()=>expect(autoBrush(clip)?.image).toBe(image));await waitForSelectionBrush(clip);
 expect(autoBrush(clip)?.prepared?.assets[0]?.tileset.id).toBe(id);expect(autoBrush(clip)?.prepared?.sources.get(source.id)).toEqual(tilesetSourceVersion(source,image));
 expect(store.document.tilesets).toHaveLength(1);expect(useProjectLibrary.getState().stamps).toHaveLength(0);
});
it("keeps unpublished recipes through saved-stamp metadata edits, rename, duplication and unchanged editor saves",async()=>{
 const {clip,store}=setup();await waitForSelectionBrush(clip);const stamp=(await saveClipAsStamp(store.document,clip,"Road"))!,record=autoBrush(stamp);
 const {setStampMeta,renameStamp,duplicateStamp,replaceStampContent}=await import("./stampActions");
 expect(autoBrush(setStampMeta(stamp.id,{favorite:true})!)).toBe(record);
 renameStamp(stamp.id,"Road renamed");const renamed=useProjectLibrary.getState().stamps.find(s=>s.id===stamp.id)!;expect(autoBrush(renamed)).toBe(record);expect(autoBrush(useEditorStore.getState().stamp)).toBe(record);
 expect(autoBrush(duplicateStamp(stamp.id)!)).toBe(record);expect(autoBrush(replaceStampContent(stamp.id,renamed)!)).toBe(record);expect(store.document.tilesets).toHaveLength(1);
});
it.each(["direct","saved"] as const)("names the first published atlas after its %s caller rather than a cached save",async caller=>{
 const {clip,store,ids}=setup();await waitForSelectionBrush(clip);const saved=(await saveClipAsStamp(store.document,clip,"Road"))!;
 let selected: typeof clip;
 if(caller==="direct"){
  selected=clipFromTileset(source,{x:2,y:1,w:3,h:3})!;prepareSelectionBrush(source,ids,new Set(),selected);await waitForSelectionBrush(selected);
 }else{
  const {renameStamp}=await import("./stampActions");renameStamp(saved.id,"Road renamed");selected=useProjectLibrary.getState().stamps.find(s=>s.id===saved.id)!;
 }
 store.beginTransaction();publishBrushAssets(selected,store);store.commit();
 expect(store.document.tilesets.find(t=>t.generated)?.name).toBe(caller==="direct"?"Source 3×3 @ 2,1 (yol)":"Road renamed (yol)");
});
it("cancels a pending save when another brush replaces its source clip",async()=>{
 let release!:(v:Awaited<ReturnType<typeof bakeSmartStamp>>)=>void;
 vi.mocked(bakeSmartStamp).mockImplementationOnce(()=>new Promise(r=>{release=r;}));
 const {store,clip}=setup(),saving=saveClipAsStamp(store.document,clip,"Road");
 await vi.waitFor(()=>expect(release).toBeTypeOf("function"),{timeout:4000});useEditorStore.getState().setStamp(null);
 release({tilesetId:"late",bytes:new Uint8Array(),bitmap:{close:vi.fn()} as unknown as ImageBitmap});
 expect(await saving).toBeNull();expect(useEditorStore.getState().stamp).toBeNull();expect(useProjectLibrary.getState().stamps).toHaveLength(0);expect(store.document.tilesets).toHaveLength(1);
});

it.each(["delete", "delete-undo-redo", "undo-publication"] as const)("project save preserves %s and its history", async removal => {
 const { store, clip } = setup();
 await waitForSelectionBrush(clip);
 const stamp = (await saveClipAsStamp(store.document, clip, "Road"))!;
 store.beginTransaction(); publishBrushAssets(stamp, store); store.commit();
 const bank = store.document.tilesets.find(t => t.generated)!;
 if (removal === "undo-publication") store.undo();
 else {
  store.dispatch({ type: "removeTileset", tilesetId: bank.id });
  if (removal === "delete-undo-redo") { store.undo(); store.redo(); }
 }
 const before = serializeLevel(store.document), history = store.historyEntries();
 await publishSavedBrushAssets();
 expect(store.document.getTileset(bank.id)).toBeUndefined();
 expect(serializeLevel(store.document)).toBe(before);
 expect(store.historyEntries()).toEqual(history);
 if (removal === "undo-publication") { store.redo(); expect(store.document.getTileset(bank.id)).toBeDefined(); }
});

it("does not republish removed assets after source refresh, reselection and saving a new library copy", async () => {
 const { store, clip, ids } = setup();
 await waitForSelectionBrush(clip);
 await saveClipAsStamp(store.document, clip, "Road");
 await publishSavedBrushAssets();
 const bank = store.document.tilesets.find(t => t.generated)!;
 store.dispatch({ type: "removeTileset", tilesetId: bank.id });
 setTilesetImage({ tilesetId: source.id, bytes: Uint8Array.of(2), bitmap: { close: vi.fn() } as unknown as ImageBitmap });
 const second = clipFromTileset(source, { x: 2, y: 1, w: 3, h: 3 })!;
 prepareSelectionBrush(source, ids, new Set(), second);
 useEditorStore.getState().setStamp(second);
 await waitForSelectionBrush(second);
 await saveClipAsStamp(store.document, second, "Road copy");
 await publishSavedBrushAssets();
 expect(store.document.getTileset(bank.id)).toBeUndefined();
});

it("a rolled-back first gesture still allows first publication on library save", async () => {
 const { store, clip } = setup();
 await waitForSelectionBrush(clip);
 const stamp = (await saveClipAsStamp(store.document, clip, "Road"))!;
 store.beginTransaction(); publishBrushAssets(stamp, store); store.rollback();
 await publishSavedBrushAssets();
 expect(store.document.tilesets.filter(t => t.generated)).toHaveLength(1);
 const before = serializeLevel(store.document), depth = store.undoDepth;
 await publishSavedBrushAssets();
 expect(serializeLevel(store.document)).toBe(before); expect(store.undoDepth).toBe(depth);
});

it("publishes an in-memory bake synchronously when source provenance is cached", async () => {
 const { clip } = setup(); await waitForSelectionBrush(clip);
 vi.mocked(bakeSmartStamp).mockImplementationOnce((_s, _l, target) => ({ tilesetId: target.id, bytes: undefined, bitmap: { close: vi.fn() } as unknown as ImageBitmap }));
 const next = clipFromTileset(source, { x: 3, y: 1, w: 3, h: 3 })!;
 prepareSelectionBrush(source, [15,16,17,27,28,29,39,40,41], new Set(), next);
 expect(preparedBrush(next)?.nineSlice?.road).toBeDefined();
 await waitForSelectionBrush(next);
});

// Frozen files generated by v0.11.0 (4bc3295), never by the code under test.
import { readFileSync } from "node:fs";
import { applySmartStampRoad, parseLevel, parseProject, parseStamp, roadMembership } from "@smap/core";
const frozen=(name:string)=>readFileSync(new URL(`../../../core/test/fixtures/v16-selection/${name}`,import.meta.url),"utf8");
for(const priorId of ["selection-ea78d74d","selection-29f4bc7e"])it(`reselects a frozen layout-1 road as the same family (${priorId}), reusing the atlas and repairing the seam`,async()=>{
 const upgrade=(text:string)=>text.replaceAll("selection-ea78d74d",priorId).replaceAll('"documentFormatVersion": 4',`"documentFormatVersion": ${priorId==="selection-ea78d74d"?4:5}`);
 const project=parseProject(upgrade(frozen("project.smap"))),recipe=parseStamp(upgrade(frozen("recipe.json"))),store=new MapStore(parseLevel(upgrade(frozen("main.json")),project.tilesets));
 const tileset=store.document.tilesets[0]!,atlas=store.document.tilesets[1]!;
 useEditorStore.getState().setProject({name:project.name,store,levelPath:"levels/main.json"});useEditorStore.getState().setActiveLayer(store.document.layers[0]!.id);useProjectLibrary.getState().load({stamps:[],levels:[],generatedRecipes:[{tilesetId:atlas.id,stamp:recipe}]});
 setTilesetImage({tilesetId:tileset.id,bytes:Uint8Array.of(1),bitmap:{close:vi.fn()} as unknown as ImageBitmap});
 const clip=clipFromTileset(tileset,{x:2,y:1,w:3,h:3})!,ids=[14,15,16,26,27,28,38,39,40];prepareSelectionBrush(tileset,ids,new Set(),clip);useEditorStore.getState().setStamp(clip);
 const prepared=(await waitForSelectionBrush(clip))!;expect(prepared.source.id).toBe(priorId);expect(prepared.assets[0]!.tileset.id).toBe(atlas.id);
 store.beginTransaction();publishBrushAssets(clip,store);applySmartStampRoad(store,prepared.stamp,store.document.layers[0]!.id,roadMembership([{x:7,y:4},{x:8,y:4}]));store.commit();
 expect(store.document.tilesets.filter(t=>t.generated)).toHaveLength(1);
 const cell=store.document.layers[0]!.getCell(6,4);expect(store.document.palette.get(cell&0x1fffffff)).toEqual({tilesetId:atlas.id,tileId:31});
});

it("equal-content wrappers, autosave metadata and unrelated painting do not start another bake",async()=>{
 const {clip,store}=setup();const prepared=await waitForSelectionBrush(clip);
 setTilesetImage({tilesetId:source.id,bytes:Uint8Array.of(1),bitmap:{close:vi.fn()} as unknown as ImageBitmap});
 store.dispatch({type:"setMapProps",name:"Renamed map"});
 store.dispatch({type:"paintCells",layerId:store.document.layers[0]!.id,cells:[{x:18,y:17,cell:store.getOrAddPaletteIndex(source.id,0)}]});
 expect(await waitForSelectionBrush(clip)).toBe(prepared);expect(vi.mocked(bakeSmartStamp)).toHaveBeenCalledTimes(1);
});
it("coalesces consecutive source changes during baking and retains leased bitmaps until the job settles",async()=>{
 let release!:(v:Awaited<ReturnType<typeof bakeSmartStamp>>)=>void;
 vi.mocked(bakeSmartStamp).mockImplementationOnce(()=>new Promise(r=>{release=r;}));
 const {clip}=setup();await vi.waitFor(()=>expect(release).toBeTypeOf("function"));
 const original=autoBrush(clip)!.image;
 const second={tilesetId:source.id,bytes:Uint8Array.of(2),bitmap:{close:vi.fn()} as unknown as ImageBitmap};
 const latest={tilesetId:source.id,bytes:Uint8Array.of(3),bitmap:{close:vi.fn()} as unknown as ImageBitmap};
 setTilesetImage(second);setTilesetImage(latest);expect(original.bitmap.close).not.toHaveBeenCalled();
 release({tilesetId:"stale",bytes:Uint8Array.of(5),bitmap:{close:vi.fn()} as unknown as ImageBitmap});
 const prepared=await waitForSelectionBrush(clip);expect(prepared?.sources.get(source.id)).toEqual(tilesetSourceVersion(source,latest));
 expect(original.bitmap.close).toHaveBeenCalledTimes(1);expect(second.bitmap.close).toHaveBeenCalledTimes(1);expect(vi.mocked(bakeSmartStamp)).toHaveBeenCalledTimes(2);
});
it("a permanent failure ends pending, formats friendly feedback and never saves a plain fallback",async()=>{
 vi.mocked(bakeSmartStamp).mockRejectedValueOnce(new Error("private native encode failure"));
 const {clip,store}=setup();await expect(waitForSelectionBrush(clip)).rejects.toMatchObject({code:"io"});
 const {brushPending}=await import("./smartBrushActions");expect(brushPending()).toBe(false);expect(autoBrush(clip)?.state.status).toBe("failed");
 expect(await saveClipAsStamp(store.document,clip,"Road")).toBeNull();expect(useProjectLibrary.getState().stamps).toHaveLength(0);
 const {useToastStore}=await import("../ui/toast/toastStore");expect(useToastStore.getState().toasts[0]!.message).not.toMatch(/Error:|private native|proje değişti/);
});
it("saved asset publication waits for a painting transaction and revalidates once it commits",async()=>{
 const {clip,store}=setup();await waitForSelectionBrush(clip);await saveClipAsStamp(store.document,clip,"Road");
 store.beginTransaction();let completed=false;const saving=publishSavedBrushAssets().then(()=>{completed=true;});
 await Promise.resolve();await Promise.resolve();expect(completed).toBe(false);
 const layerId=store.document.layers[0]!.id;store.dispatch({type:"paintCells",layerId,cells:[{x:18,y:17,cell:store.getOrAddPaletteIndex(source.id,0)}]});store.commit();await saving;
 expect(store.document.tilesets.filter(t=>t.generated)).toHaveLength(1);expect(store.document.getLayer(layerId)!.getCell(18,17)).not.toBe(0);
});

it("plain source rectangles keep ordinary flip/save semantics and their native preview association",async()=>{
 const {brushCandidate,brushSource}=await import("./smartBrushActions");const {flipBrush}=await import("./rotateCommands");const {cellFlags,FLIP_H}=await import("@smap/core");
 const {store}=setup(),clip=clipFromTileset(source,{x:2,y:1,w:2,h:2})!;
 prepareSelectionBrush(source,[14,15,26,27],new Set(),clip);useEditorStore.getState().setStamp(clip);
 expect(brushCandidate()).toBe(false);flipBrush("x");
 const flipped=useEditorStore.getState().stamp!;expect([...flipped.layers[0]!.cells].every(c=>cellFlags(c)===FLIP_H)).toBe(true);expect(brushSource(flipped)?.id).toBe(source.id);
 const saved=(await saveClipAsStamp(store.document,flipped,"Object"))!;expect(saved.nineSlice).toBeUndefined();expect([...saved.layers[0]!.cells].every(c=>cellFlags(c)===FLIP_H)).toBe(true);
});

it.each(["clone","store"] as const)("a pending inline save survives an equal-recipe %s replacement",async change=>{
 let release!:(v:Awaited<ReturnType<typeof bakeSmartStamp>>)=>void;
 vi.mocked(bakeSmartStamp).mockImplementationOnce(()=>new Promise(r=>{release=r;}));
 const {store,clip}=setup(),saving=saveClipAsStamp(store.document,clip,"Road");await vi.waitFor(()=>expect(release).toBeTypeOf("function"));
 if(change==="clone"){
  const {attachPreparedBrush}=await import("./smartBrushActions"),next={...clip,layers:clip.layers.map(l=>({...l,name:"Renamed label"}))};attachPreparedBrush(next,clip);useEditorStore.getState().setStamp(next);
 }else{
  const other=new MapStore(createDocument({width:24,height:20,tilesets:[source]}));other.dispatch({type:"addLayer",layer:{name:"Ground"}});other.clearHistory();useEditorStore.getState().switchLevel({name:"Test",store:other,levelPath:"levels/main.json"});
 }
 release({tilesetId:"pending",bytes:Uint8Array.of(1),bitmap:{close:vi.fn()} as unknown as ImageBitmap});
 expect((await saving)?.nineSlice?.road).toBeDefined();expect(useProjectLibrary.getState().stamps).toHaveLength(1);
});
