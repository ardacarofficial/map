import { test, expect } from "../support/fixtures";
import { openRoadSheet, selectRoad, saveRoad, dragRoad, roadCells, waitForSaveIdle } from "../support/smartStampDock";

for (const saved of [false,true]) {
  test(`dock 3×3 → ${saved ? "Stamp olarak kaydet → " : ""}B drag draws a road, never repeated blocks`, async ({ page }) => {
    await openRoadSheet(page);
    await selectRoad(page);
    if (saved) await saveRoad(page);
    await page.keyboard.press("b");
    await dragRoad(page, [[4,4],[7,4]]);
    const result = await roadCells(page);
    expect(result.cells, "a four-cell, one-cell-high road; repeated 3×3 blocks are forbidden").toHaveLength(4);
    expect(result.generated).toHaveLength(1);
    expect(result.generated[0]!.name).toMatch(/\(yol\)$/);
    expect(result.generated[0]!.name).toBe(saved?"Köy yolu (yol)":"smart-road-32 3×3 @ 2,1 (yol)");
    expect(result.cells.map(c => [c.x,c.y,c.tilesetId,c.flags])).toEqual([4,5,6,7].map(x => [x,4,result.generated[0]!.id,0]));
    // Seed 0, layout-1: compact east cap, EW bank, compact EW, compact west cap.
    expect(result.cells.map(c=>c.tileId)).toEqual([12,31,31,14]);
    expect(result.cells.map(c=>c.tileId)).not.toEqual([14,15,16,14,15,16]);
  });
}

test("reselecting an unused saved recipe publishes the direct source name and reuses its reserved atlas",async({page})=>{
 await openRoadSheet(page);await selectRoad(page);await saveRoad(page);
 const reserved=await page.evaluate(async()=>{const{useProjectLibrary}=await import(/* @vite-ignore */String("/src/io/projectLibrary.ts"));return useProjectLibrary.getState().stamps[0].nineSlice.road.tilesetId;});
 await page.locator("[data-panel-tab='tileset']").click();await selectRoad(page);await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();
 await page.keyboard.press("b");await dragRoad(page,[[4,4],[7,4]]);
 expect((await roadCells(page)).generated).toEqual([{id:reserved,name:"smart-road-32 3×3 @ 2,1 (yol)"}]);
});

test("reopened single-layer smart stamp uses the selected layer for R areas and B roads",async({page})=>{
 await openRoadSheet(page);await selectRoad(page);await saveRoad(page);await page.keyboard.press("Control+s");
 const{readOpfsText}=await import("../support/fixtures");await expect.poll(()=>readOpfsText(page,"stamps/koy-yolu.json")).not.toBeNull();await waitForSaveIdle(page);
 await page.reload();await page.getByRole("button",{name:/^Aç…/}).click();await page.locator("[data-panel-tab='stamps']").click();await page.locator("[data-stamp-id='koy-yolu']").dblclick();
 await page.keyboard.press("Control+Shift+n");
 const counts=()=>page.evaluate(async()=>{const{useEditorStore}=await import(/* @vite-ignore */String("/src/state/editorStore.ts"));const s=useEditorStore.getState(),doc=s.project.store.document;return doc.layers.filter((l:{type:string})=>l.type==="tile").map((l:{id:string;getCell(x:number,y:number):number})=>{let cells=0;for(let y=0;y<doc.map.height;y++)for(let x=0;x<doc.map.width;x++)if(l.getCell(x,y))cells++;return{active:l.id===s.activeLayerId,cells};});});
 await expect.poll(async()=>(await counts()).length).toBe(2);await page.keyboard.press("r");await dragRoad(page,[[4,4],[8,7]]);
 expect(await counts()).toEqual([{active:false,cells:0},{active:true,cells:20}]);
 await page.keyboard.press("b");await dragRoad(page,[[4,11],[7,11]]);expect(await counts()).toEqual([{active:false,cells:0},{active:true,cells:24}]);
});

for (const size of [16,32]) for (const saved of [false,true]) for (const flip of ["","x","y"] as const) {
  test(`offset sheet ${size}px ${saved?"saved":"direct"} ${flip||"normal"}: exact slots, preview, one undo and redo`,async({page})=>{
    await openRoadSheet(page,size);await selectRoad(page);
    if(saved)await saveRoad(page);
    await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();
    await page.keyboard.press("b");if(flip)await page.keyboard.press(flip);
    const {cellPoint}=await import("../support/smartStamp");
    const point=await cellPoint(page,4,4);await page.mouse.move(point.x,point.y);
    await expect.poll(()=>page.evaluate(()=> (window as unknown as {__smap:{smartPreview:unknown}}).__smap.smartPreview!==null)).toBe(true);
    const before=await roadCells(page);expect(before.cells).toHaveLength(0);expect(before.generated).toHaveLength(0);
    await dragRoad(page,[[4,4],[7,4]]);
    const after=await roadCells(page),flags=flip==="x"?0x80000000:flip==="y"?0x40000000:0;
    expect(after.cells).toEqual([4,5,6,7].map((x,i)=>({x,y:4,tilesetId:after.generated[0]!.id,tileId:(flip==="x"?[14,31,31,12]:[12,31,31,14])[i],flags})));
    await page.keyboard.press("Control+z");expect(await roadCells(page)).toEqual(before);
    await page.keyboard.press("Control+Shift+z");expect(await roadCells(page)).toEqual(after);
    // R has its own default and supports compact targets without changing B's default.
    await page.keyboard.press("r");await expect(page.locator("[data-smart-stamp-mode]")).toHaveAttribute("data-smart-stamp-mode","area");
    for(const [x,y,w,h,slots]of [[1,7,1,1,[15]],[3,7,1,4,[9,10,10,11]],[5,7,2,2,[0,2,6,8]],[8,7,5,4,[0,1,1,1,2,3,4,4,4,5,3,4,4,4,5,6,7,7,7,8]]] as const){
      const a=await cellPoint(page,x,y),b=await cellPoint(page,x+w-1,y+h-1);
      await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);
      await expect.poll(()=>page.evaluate(()=> (window as unknown as {__smap:{smartPreview:{layers:{writes:unknown[]}[]}|null}}).__smap.smartPreview?.layers.flatMap(l=>l.writes).length??0)).toBe(w*h);
      const ghost=await page.evaluate(()=> (window as unknown as {__smap:{smartPreview:{layers:{writes:{x:number;y:number;tile:{tileId:number};flags?:number}[]}[]}}}).__smap.smartPreview.layers.flatMap(l=>l.writes));
      await page.mouse.up();const result=(await roadCells(page)).cells.filter(c=>c.x>=x&&c.x<x+w&&c.y>=y&&c.y<y+h);
      expect(result.map(c=>({x:c.x,y:c.y,tileId:c.tileId,flags:c.flags}))).toEqual(ghost.map(c=>({x:c.x,y:c.y,tileId:c.tile.tileId,flags:c.flags??0})));
      if(!flip)expect(result.map(c=>c.tileId)).toEqual(slots);
      await page.keyboard.press("Control+z");
    }
    await page.keyboard.press("b");await expect(page.locator("[data-smart-stamp-mode]")).toHaveAttribute("data-smart-stamp-mode","road");
  });
}

test("junctions L, T and +, separate strokes join and reselection reuses the same atlas without a library stamp",async({page})=>{
  await openRoadSheet(page);await selectRoad(page);
  await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();
  await dragRoad(page,[[2,3],[8,3]]);
  await dragRoad(page,[[8,3],[8,7],[11,7]]);
  await dragRoad(page,[[5,1],[5,6]]);
  await dragRoad(page,[[8,5],[12,5]]);
  const result=await roadCells(page);
  // Fixed layout-1 bank masks, independent of the planner and profile builder.
  const masks=[0,1,4,5,7,16,17,20,21,23,28,29,31,64,65,68,69,71,80,81,84,85,87,92,93,95,112,113,116,117,119,124,125,127,193,197,199,209,213,215,221,223,241,245,247,253,255];
  const prefix=[28,124,112,31,255,241,7,199,193,16,17,1,4,68,64,0];
  const maskAt=(x:number,y:number)=>{const c=result.cells.find(c=>c.x===x&&c.y===y)!;return c.tileId<16?prefix[c.tileId]:masks[c.tileId-16];};
  expect(maskAt(11,7)).toBe(64);expect(maskAt(8,7)).toBe(5);expect(maskAt(8,5)).toBe(21);expect(maskAt(5,3)).toBe(85);
  const id=result.generated[0]!.id;await selectRoad(page);await dragRoad(page,[[15,3],[17,3]]);
  expect((await roadCells(page)).generated.map(g=>g.id)).toEqual([id]);
  expect(await page.evaluate(async()=>{const {useProjectLibrary}=await import(/* @vite-ignore */ String("/src/io/projectLibrary.ts"));return useProjectLibrary.getState().stamps.length;})).toBe(0);
});

test("Akıllı off is a plain block, per-selection preference and saved preference survive reopen",async({page})=>{
  await openRoadSheet(page);await selectRoad(page);const toggle=page.locator("[data-smart-brush]");await expect(toggle).toBeChecked();await toggle.click();
  await dragRoad(page,[[4,4],[7,4]]);expect((await roadCells(page)).cells).toHaveLength(18);expect((await roadCells(page)).generated).toHaveLength(0);
  await page.keyboard.press("Control+z");await selectRoad(page);await expect(toggle).not.toBeChecked();
  await saveRoad(page);
  await page.locator("[data-panel-tab='stamps']").click();
  await page.locator("[data-stamp-id='koy-yolu'] [data-stamp-star]").click();
  await page.keyboard.press("Control+s");
  const {readOpfsText}=await import("../support/fixtures");await expect.poll(()=>readOpfsText(page,"project.smap")).not.toBeNull();
  await expect.poll(()=>readOpfsText(page,"stamps/koy-yolu.json")).not.toBeNull();
  expect(JSON.parse((await readOpfsText(page,"stamps/koy-yolu.json"))!).smartDisabled).toBe(true);
  await waitForSaveIdle(page);await page.reload();await page.getByRole("button",{name:/^Aç…/}).click();
  // Library selection and placement through the real card.
  await page.locator("[data-panel-tab='stamps']").click();
  await page.locator("[data-stamp-id='koy-yolu']").dblclick();
  await expect(toggle).not.toBeChecked();await page.keyboard.press("b");await dragRoad(page,[[4,4],[7,4]]);expect((await roadCells(page)).cells).toHaveLength(18);
});

for(const [variant,width,height,qualifies]of [["-wide",6,6,true],["-empty",3,3,false],["",2,2,false],["-banded",6,6,false]] as const){
 test(`${width}×${height} ${variant||"small"}: conservative automatic detection`,async({page})=>{
  await openRoadSheet(page,32,variant);await selectRoad(page,width,height);
  if(qualifies){await expect(page.locator("[data-smart-brush]")).toBeChecked();await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();await dragRoad(page,[[4,4],[7,4]]);expect((await roadCells(page)).cells).toHaveLength(4);}
  else{await expect(page.locator("[data-smart-brush]")).toHaveCount(0);await dragRoad(page,[[4,4]]);expect((await roadCells(page)).generated).toHaveLength(0);expect((await roadCells(page)).cells).toHaveLength(width*height-(variant==="-empty"?1:0));}
 });
}

for(const key of ["z","Shift+z"]){test(`rotation ${key}: preview is precisely the road that is placed`,async({page})=>{
 await openRoadSheet(page);await selectRoad(page);await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();await page.keyboard.press(key);
 const {cellPoint}=await import("../support/smartStamp");const p=await cellPoint(page,4,4);await page.mouse.move(p.x,p.y);
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {__smap:{smartPreview:{layers:{writes:unknown[]}[]}|null}}).__smap.smartPreview?.layers.flatMap(l=>l.writes).length??0)).toBe(1);
 const ghost=await page.evaluate(()=>(window as unknown as {__smap:{smartPreview:{layers:{writes:{x:number;y:number;tile:{tilesetId:string;tileId:number};flags:number}[]}[]}}}).__smap.smartPreview.layers.flatMap(l=>l.writes));
 await page.mouse.down();await page.mouse.up();expect((await roadCells(page)).cells).toEqual(ghost.map(w=>({x:w.x,y:w.y,...w.tile,flags:w.flags})));
});}

for(const saved of [false,true])test(`${saved?"saved":"direct"} brush: locked and hidden targets give feedback and leave no atlas or cells`,async({page})=>{
 await openRoadSheet(page);await selectRoad(page);if(saved)await saveRoad(page);await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();
 const layer=page.locator("[data-layer-id]").first();
 await layer.getByRole("button",{name:"Kilitle",exact:true}).click();await page.keyboard.press("b");await dragRoad(page,[[4,4],[7,4]]);expect(await roadCells(page)).toEqual({cells:[],generated:[]});
 await expect(page.locator("[data-toaster]")).toContainText("katmanı kilitli");
 await layer.getByRole("button",{name:"Kilidi aç",exact:true}).click();await layer.getByRole("button",{name:"Gizle",exact:true}).click();
 await page.keyboard.press("r");await dragRoad(page,[[4,4],[7,7]]);expect(await roadCells(page)).toEqual({cells:[],generated:[]});
 await expect(page.locator("[data-toaster]")).toContainText("katmanı gizli");
});

test("direct recipe: source pixels stay intact, generated straight pixels match authored halves, Save As and reopen need no library stamp",async({page})=>{
 await openRoadSheet(page);await selectRoad(page);await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();
 const sourceBytes=await page.evaluate(async()=>{const{getTilesetImage}=await import(/* @vite-ignore */String("/src/state/tilesetImages.ts"));return [...getTilesetImage("smart-road-32").bytes];});
 await dragRoad(page,[[4,4],[7,4]]);const before=await roadCells(page);
 expect(await page.evaluate(async()=>{
  const{getTilesetImage}=await import(/* @vite-ignore */String("/src/state/tilesetImages.ts"));const{useEditorStore}=await import(/* @vite-ignore */String("/src/state/editorStore.ts"));
  const doc=useEditorStore.getState().project.store.document,bank=doc.tilesets.find((t:{generated?:unknown})=>t.generated);
  const read=(id:string)=>{const bmp=getTilesetImage(id).bitmap,c=new OffscreenCanvas(bmp.width,bmp.height),ctx=c.getContext("2d")!;ctx.drawImage(bmp,0,0);return{width:bmp.width,data:ctx.getImageData(0,0,bmp.width,bmp.height).data};};
  const src=read("smart-road-32"),dst=read(bank.id),size=32;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)for(let c=0;c<4;c++){
   const sourceRow=y<16?1:3;
   const a=((sourceRow*size+y)*src.width+3*size+x)*4+c;
   const b=((Math.floor(31/bank.columns)*size+y)*dst.width+(31%bank.columns)*size+x)*4+c;
   if(src.data[a]!==dst.data[b])return false;
  }
  return true;
 })).toBe(true);
 expect(await page.evaluate(async()=>{const{getTilesetImage}=await import(/* @vite-ignore */String("/src/state/tilesetImages.ts"));return [...getTilesetImage("smart-road-32").bytes];})).toEqual(sourceBytes);
 await page.evaluate(()=>{(window as unknown as{showDirectoryPicker:()=>Promise<FileSystemDirectoryHandle>}).showDirectoryPicker=async()=>(await navigator.storage.getDirectory()).getDirectoryHandle("direct-copy",{create:true});});
 await page.keyboard.press("Control+Shift+s");
 const{readOpfsText}=await import("../support/fixtures");await expect.poll(()=>readOpfsText(page,"direct-copy/project.smap")).not.toBeNull();
 const project=JSON.parse((await readOpfsText(page,"direct-copy/project.smap"))!);expect(project.tilesets.filter((t:{generated?:unknown})=>t.generated)).toHaveLength(1);
 await waitForSaveIdle(page);await page.reload();await page.evaluate(()=>{(window as unknown as{showDirectoryPicker:()=>Promise<FileSystemDirectoryHandle>}).showDirectoryPicker=async()=>(await navigator.storage.getDirectory()).getDirectoryHandle("direct-copy");});
 await page.getByRole("button",{name:/^Aç…/}).click();await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();expect(await roadCells(page)).toEqual(before);
 expect(await page.evaluate(async()=>{const{useProjectLibrary}=await import(/* @vite-ignore */String("/src/io/projectLibrary.ts"));const l=useProjectLibrary.getState();return{stamps:l.stamps.length,recipes:l.generatedRecipes.length};})).toEqual({stamps:0,recipes:1});
});

test("per-tool overrides reset on a new brush; F keeps the source pattern",async({page})=>{
 await openRoadSheet(page);await selectRoad(page);await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();
 await page.getByRole("radio",{name:"Alan",exact:true}).click();await page.keyboard.press("r");await page.getByRole("radio",{name:"Yol",exact:true}).click();
 await page.keyboard.press("b");await expect(page.locator("[data-smart-stamp-mode]")).toHaveAttribute("data-smart-stamp-mode","area");
 // A single tile resets brush identity, then the original rectangle starts with tool defaults.
 await selectRoad(page,1,1);await selectRoad(page);await expect(page.locator("[data-smart-stamp-mode]")).toHaveAttribute("data-smart-stamp-mode","road");
 await page.keyboard.press("r");await expect(page.locator("[data-smart-stamp-mode]")).toHaveAttribute("data-smart-stamp-mode","area");
 await page.keyboard.press("f");await dragRoad(page,[[4,4]]);
 const result=await roadCells(page);expect(result.generated).toHaveLength(0);expect(result.cells.length).toBeGreaterThan(9);expect(result.cells.every(c=>c.tilesetId==="smart-road-32")).toBe(true);
 expect(result.cells.filter(c=>c.y===0).slice(0,6).map(c=>c.tileId)).toEqual([14,15,16,14,15,16]);
});

test("first road gesture cancellation, pointercancel and lost capture roll back cells and atlas together",async({page})=>{
 await openRoadSheet(page);await selectRoad(page);await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();
 const{cellPoint}=await import("../support/smartStamp");const a=await cellPoint(page,4,4),b=await cellPoint(page,7,4),canvas=page.locator("canvas[aria-label='map canvas']").first();
 for(const cancel of ["Escape","pointercancel","lostpointercapture"]){
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:4});expect((await roadCells(page)).generated).toHaveLength(1);
  if(cancel==="Escape")await page.keyboard.press(cancel);else await canvas.dispatchEvent(cancel,{pointerId:1});
  await page.mouse.up();expect(await roadCells(page)).toEqual({cells:[],generated:[]});
 }
});

test("finishing async preparation keeps the inline stamp name and save button stable",async({page})=>{
 await openRoadSheet(page);
 await page.evaluate(()=>{
  const gate={entered:false,release:()=>{}};(window as unknown as{pendingRoad:typeof gate}).pendingRoad=gate;
  const encode=HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob=function(callback,...args){
   if(this.width===256&&this.height===256){HTMLCanvasElement.prototype.toBlob=encode;encode.call(this,blob=>{gate.release=()=>callback(blob);gate.entered=true;},...args);}else encode.call(this,callback,...args);
  };
 });
 await selectRoad(page);await expect.poll(()=>page.evaluate(()=>(window as unknown as{pendingRoad:{entered:boolean}}).pendingRoad.entered)).toBe(true);
 await page.locator("[data-action='saveClipStamp']").click();const name=page.getByRole("textbox",{name:"Stamp adı",exact:true});await name.fill("Köy yolu");
 await page.evaluate(()=>(window as unknown as{pendingRoad:{release():void}}).pendingRoad.release());
 await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();await expect(name).toHaveValue("Köy yolu");
 await page.getByRole("button",{name:"Kaydet",exact:true}).click();await page.keyboard.press("b");await dragRoad(page,[[4,4],[7,4]]);expect((await roadCells(page)).cells).toHaveLength(4);
});

test("R Alan outlines keep authored corners and leave their interior untouched",async({page})=>{
 await openRoadSheet(page);await selectRoad(page);await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();await page.keyboard.press("r");
 await page.getByRole("radio",{name:"Çerçeve",exact:true}).click();await dragRoad(page,[[4,4],[9,8]]);
 const result=await roadCells(page);expect(result.cells).toHaveLength(18);expect(result.cells.some(c=>c.x===6&&c.y===6)).toBe(false);
 expect(result.cells.filter(c=>(c.x===4||c.x===9)&&(c.y===4||c.y===8)).map(c=>c.tileId)).toEqual([0,2,6,8]);
 await page.keyboard.press("Control+z");expect(await roadCells(page)).toEqual({cells:[],generated:[]});
});

test("saving during preparation then selecting another brush cancels the stale save",async({page})=>{
 await openRoadSheet(page);
 await page.evaluate(()=>{
  const gate={entered:false,release:()=>{}};(window as unknown as{pendingRoad:typeof gate}).pendingRoad=gate;
  const encode=HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob=function(callback,...args){
   if(this.width===256&&this.height===256){HTMLCanvasElement.prototype.toBlob=encode;encode.call(this,blob=>{gate.release=()=>callback(blob);gate.entered=true;},...args);}else encode.call(this,callback,...args);
  };
 });
 await selectRoad(page);await expect.poll(()=>page.evaluate(()=>(window as unknown as{pendingRoad:{entered:boolean}}).pendingRoad.entered)).toBe(true);
 await page.evaluate(async()=>{const{useEditorStore}=await import(/* @vite-ignore */String("/src/state/editorStore.ts"));(window as unknown as{pendingRoad:{source:unknown}}).pendingRoad.source=useEditorStore.getState().stamp;});
 await page.locator("[data-action='saveClipStamp']").click();await page.getByRole("textbox",{name:"Stamp adı",exact:true}).fill("Köy yolu");await page.getByRole("button",{name:"Kaydet",exact:true}).click();
 await selectRoad(page,1,1);await page.evaluate(async()=>{const{waitForSelectionBrush}=await import(/* @vite-ignore */String("/src/commands/smartBrushActions.ts"));const gate=(window as unknown as{pendingRoad:{release():void;source:unknown}}).pendingRoad;gate.release();await waitForSelectionBrush(gate.source);});
 await expect.poll(()=>page.evaluate(async()=>{const{useEditorStore}=await import(/* @vite-ignore */String("/src/state/editorStore.ts"));const{useProjectLibrary}=await import(/* @vite-ignore */String("/src/io/projectLibrary.ts"));const s=useEditorStore.getState();return{hasStamp:s.stamp!==null,selection:s.selection,stamps:useProjectLibrary.getState().stamps.length};})).toEqual({hasStamp:false,selection:{tilesetId:"smart-road-32",tileId:14},stamps:0});
 expect(await roadCells(page)).toEqual({cells:[],generated:[]});await page.keyboard.press("b");await dragRoad(page,[[4,4]]);expect((await roadCells(page)).cells).toEqual([{x:4,y:4,tilesetId:"smart-road-32",tileId:14,flags:0}]);
});
