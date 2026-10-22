import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, dropFile, confirmTilesetCard, readOpfsText, WELCOME_DROP } from "../support/fixtures";
import { openRoadSheet,selectRoad,saveRoad,dragRoad,roadCells,waitForSaveIdle } from "../support/smartStampDock";
async function watchErrors(page:Page){
 await page.evaluate(async()=>{
  const {useToastStore}=await import(/* @vite-ignore */String("/src/ui/toast/toastStore.ts"));
  const errors:string[]=[];(window as unknown as {smartErrors:string[]}).smartErrors=errors;
  useToastStore.subscribe((s:{toasts:{kind:string;message:string}[]})=>{for(const toast of s.toasts)if(toast.kind==="error")errors.push(toast.message);});
 });
}
async function noErrors(page:Page){expect(await page.evaluate(()=>(window as unknown as {smartErrors:string[]}).smartErrors)).toEqual([]);}
async function saveFolder(page:Page){
 await page.locator("canvas[aria-label='map canvas']").first().focus();await page.keyboard.press("Control+s");
 await expect.poll(()=>readOpfsText(page,"project.smap")).not.toBeNull();await waitForSaveIdle(page);
}
for(const size of [16,32])for(const saved of [false,true])test(`Arda ${size}px ${saved?"saved":"direct"}: autosaved folder, B straight/L/T and exact undo`,async({page})=>{
 await openRoadSheet(page,size);await watchErrors(page);await saveFolder(page);await selectRoad(page);
 if(saved)await saveRoad(page);
 await expect(page.locator("[data-smart-brush]")).toBeChecked();await page.keyboard.press("b");
 await dragRoad(page,[[4,4],[9,4],[9,8]]);await dragRoad(page,[[6,2],[6,7]]);
 const result=await roadCells(page);expect(result.generated).toHaveLength(1);expect(result.cells).toHaveLength(15);
 expect(result.cells.every(c=>c.tilesetId===result.generated[0]!.id)).toBe(true);
 await page.keyboard.press("Control+z");expect((await roadCells(page)).cells).toHaveLength(10);
 await page.keyboard.press("Control+Shift+z");expect(await roadCells(page)).toEqual(result);
 // Wait for the real default autosave scheduler; no manual save after painting.
 await expect.poll(async()=>JSON.parse((await readOpfsText(page,"project.smap"))??"{}").tilesets?.filter((t:{generated?:unknown})=>t.generated).length,{timeout:20000}).toBe(1);
 if(saved)expect(JSON.parse((await readOpfsText(page,"stamps/koy-yolu.json"))!).nineSlice.road).toBeDefined();
 await noErrors(page);
});
async function mismatch(page:Page,adopt=false){
 await openRoadSheet(page,32);await watchErrors(page);
 const bytes=[...readFileSync(new URL("../fixtures/smart-road-16.png",import.meta.url))];
 await dropFile(page,"body","source-road-16.png",bytes);await page.getByTestId("tileset-card").getByLabel("Tile genişliği").fill("16");await confirmTilesetCard(page,{gridChoice:"ask"});
 const question=page.locator("[data-dialog='smart-grid']");await expect(question).toBeVisible();
 await question.getByRole("button",{name:adopt?"Haritayı 16 px yap":"Harita ölçüsünü koru",exact:true}).click();
 await selectRoad(page);await page.keyboard.press("b");
}
test("16px source in empty 32px map: reason, joined native preview and undoable one-click remedy",async({page})=>{
 await mismatch(page);
 await expect(page.locator("[data-smart-brush]")).toBeDisabled();
 await expect(page.locator("[data-smart-brush-reason]")).toHaveText("Kaynak 16×16 px · harita 32×32 px");
 const preview=page.locator("[data-brush-preview]");await expect(preview).toHaveAttribute("data-preview-grid","16x16");
 expect(await preview.evaluate((canvas:HTMLCanvasElement)=>{
  const ctx=canvas.getContext("2d")!,data=ctx.getImageData(0,Math.floor(canvas.height/2),canvas.width,1).data;
  const covered=[];for(let x=0;x<canvas.width;x++)if(data[x*4+3])covered.push(x);
  return covered.length>0&&covered[covered.length-1]!-covered[0]!+1===covered.length;
 })).toBe(true);
 await page.locator("[data-smart-grid-remedy]").click();await expect(page.locator("[data-smart-brush]")).toBeChecked();
 await page.locator("canvas[aria-label='map canvas']").first().focus();await page.keyboard.press("Control+z");await expect(page.locator("[data-smart-brush-reason]")).toContainText("harita 32×32");
 await page.keyboard.press("Control+Shift+z");await expect(page.locator("[data-smart-brush]")).toBeChecked();
 await dragRoad(page,[[4,4],[7,4]]);expect((await roadCells(page)).cells).toHaveLength(4);await noErrors(page);
});
test("empty-map import asks once and adopts without touching source pixels",async({page})=>{
 await mismatch(page,true);await expect(page.locator("[data-smart-brush]")).toBeChecked();
 expect(await page.evaluate(async()=>{const {getTilesetImage}=await import(/* @vite-ignore */String("/src/state/tilesetImages.ts"));return [...getTilesetImage("source-road-16").bytes];})).toEqual([...readFileSync(new URL("../fixtures/smart-road-16.png",import.meta.url))]);
 await dropFile(page,"body","another-road-32.png",[...readFileSync(new URL("../fixtures/smart-road-32.png",import.meta.url))]);await confirmTilesetCard(page,{gridChoice:"ask"});
 await expect(page.locator("[data-dialog='smart-grid']")).toBeHidden();
 await dragRoad(page,[[4,4],[7,4]]);expect((await roadCells(page)).cells).toHaveLength(4);await noErrors(page);
});
test("populated mismatch opens the existing new-map dialog prefilled and preserves selection",async({page})=>{
 await mismatch(page);await dragRoad(page,[[4,4]]);expect((await roadCells(page)).cells).toHaveLength(9);
 await expect(page.locator("[data-smart-grid-remedy]")).toHaveText("16 px yeni harita");await page.locator("[data-smart-grid-remedy]").click();
 const dialog=page.locator("[data-dialog='new-level']");await expect(dialog).toBeVisible();await expect(dialog.getByLabel("Tile boyutu",{exact:true})).toHaveValue("16");
 await dialog.locator("button[type='submit']").click();await expect(dialog).toBeHidden();await expect(page.locator("[data-smart-brush]")).toBeChecked();
 await page.keyboard.press("b");await dragRoad(page,[[4,4],[7,4]]);expect((await roadCells(page)).cells).toHaveLength(4);await noErrors(page);
});
async function openBush(page:Page,size:number){
 await page.goto("/");await expect(page.locator(WELCOME_DROP)).toBeVisible();
 await dropFile(page,WELCOME_DROP,`bush-${size}.png`,[...readFileSync(new URL(`../fixtures/smart-object-${size}-bush.png`,import.meta.url))]);
 await page.getByTestId("tileset-card").getByLabel("Tile genişliği",{exact:true}).fill(String(size));await confirmTilesetCard(page);await watchErrors(page);
 const grid=page.locator("[data-tileset-grid]").first(),box=(await grid.boundingBox())!;
 await page.mouse.move(box.x+box.width/6,box.y+box.height/6);await page.mouse.down();await page.mouse.move(box.x+box.width*5/6,box.y+box.height*5/6,{steps:4});await page.mouse.up();
}
for(const size of [16,32])for(const saved of [false,true])test(`round bush ${size}px ${saved?"saved":"direct"} stays one plain object`,async({page})=>{
 await openBush(page,size);
 await expect(page.locator("[data-smart-brush]")).toBeEnabled();await expect(page.locator("[data-smart-brush]")).not.toBeChecked();await expect(page.locator("[data-smart-brush-reason]")).toHaveText("Tek nesne");await expect(page.getByRole("radio",{name:"Yol",exact:true})).toHaveCount(0);
 if(saved&&size===32)await page.keyboard.press("x");
 if(saved)await saveRoad(page);
 await page.keyboard.press("b");await dragRoad(page,[[4,4]]);
 const result=await roadCells(page);expect(result.generated).toHaveLength(0);expect(result.cells).toHaveLength(9);expect(result.cells.map(c=>c.tileId)).toEqual(saved&&size===32?[2,1,0,5,4,3,8,7,6]:[0,1,2,3,4,5,6,7,8]);expect(result.cells.every(c=>c.flags===(saved&&size===32?0x80000000:0))).toBe(true);await noErrors(page);
});
for(const size of [16,32])test(`bush ${size}px: force smart, save, reload, then switch back to a plain object`,async({page})=>{
 await openBush(page,size);const toggle=page.locator("[data-smart-brush]");
 await expect(toggle).toBeEnabled();await expect(toggle).not.toBeChecked();
 await expect(toggle).toHaveAttribute("aria-description","Tek nesne olarak algılandı. Yol/alan fırçası olarak kullanmak için açın.");
 await toggle.click();await expect(toggle).toBeChecked();await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();
 await page.keyboard.press("b");await dragRoad(page,[[4,4],[7,4]]);
 const direct=await roadCells(page);expect(direct.generated).toHaveLength(1);expect(direct.cells).toHaveLength(4);
 expect(direct.cells.every(c=>c.tilesetId===direct.generated[0]!.id)).toBe(true);
 await saveRoad(page);await expect(toggle).toBeChecked();await page.keyboard.press("b");await dragRoad(page,[[7,4],[7,6]]);
 expect((await roadCells(page)).cells).toHaveLength(6);await saveFolder(page);
 const saved=JSON.parse((await readOpfsText(page,"stamps/koy-yolu.json"))!);expect(saved.nineSlice.border).toBe(1);expect(saved.nineSlice.road).toBeDefined();expect(saved.smartDisabled).not.toBe(true);await noErrors(page);
 await page.reload();await watchErrors(page);await page.getByRole("button",{name:/^Aç…/}).click();
 await page.locator("[data-panel-tab='stamps']").click();await page.locator("[data-stamp-id='koy-yolu']").dblclick();
 await expect(toggle).toBeChecked();await page.keyboard.press("b");await dragRoad(page,[[4,8],[7,8]]);
 const reopened=await roadCells(page);expect(reopened.generated).toHaveLength(1);expect(reopened.cells).toHaveLength(10);
 expect(reopened.cells.every(c=>c.tilesetId===direct.generated[0]!.id)).toBe(true);
 await toggle.click();await expect(toggle).not.toBeChecked();await page.keyboard.press("b");await dragRoad(page,[[12,4]]);
 const plain=(await roadCells(page)).cells.filter(c=>c.tilesetId!==direct.generated[0]!.id);
 expect(plain).toHaveLength(9);expect(plain.map(c=>c.tileId)).toEqual([0,1,2,3,4,5,6,7,8]);await noErrors(page);
});
for(const size of [16,32])for(const material of ["pebbles","moss"])test(`asymmetric ${size}px ${material} path stays automatically smart`,async({page})=>{
 await openRoadSheet(page,size,`-asymmetric-${material}`);await watchErrors(page);await selectRoad(page);
 await expect(page.locator("[data-smart-brush]")).toBeChecked();await page.keyboard.press("b");
 await dragRoad(page,[[4,4],[8,4],[8,7]]);await dragRoad(page,[[6,2],[6,6]]);
 const result=await roadCells(page);expect(result.generated).toHaveLength(1);expect(result.cells).toHaveLength(12);
 expect(result.cells.every(c=>c.tilesetId===result.generated[0]!.id)).toBe(true);await noErrors(page);
});
for(const scale of [1,1.25,1.5])test(`preview / save tooltip geometry at ${scale} display scale`,async({browser})=>{
 const context=await browser.newContext({viewport:{width:1366,height:768},deviceScaleFactor:scale});const page=await context.newPage();
 await openRoadSheet(page);await selectRoad(page);const button=page.locator("[data-action='saveClipStamp']");await button.hover();
 await page.waitForTimeout(600);await expect(page.getByRole("tooltip").filter({hasText:"Stamp olarak kaydet"})).toHaveCount(0);
 // Informative smart tooltip remains separated from its trigger.
 const trigger=page.locator("[data-smart-brush]");await trigger.hover();const tip=page.getByRole("tooltip");await expect(tip).toBeVisible();
 const a=(await trigger.boundingBox())!,b=(await tip.boundingBox())!;expect(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y).toBe(true);
 await button.click();await expect(page.getByRole("textbox",{name:"Stamp adı",exact:true})).toBeVisible();await expect(tip).toBeHidden();await context.close();
});

test("failed initial preparation keeps the inline save form and shows only friendly errors",async({page})=>{
 await openRoadSheet(page);await watchErrors(page);
 await page.evaluate(()=>(window as unknown as {__smap:{smartBrushPreparation:{hold():void}}}).__smap.smartBrushPreparation.hold());
 await selectRoad(page);
 await page.evaluate(()=>(window as unknown as {__smap:{smartBrushPreparation:{release(fail:boolean):void}}}).__smap.smartBrushPreparation.release(true));
 await expect(page.locator("[data-toaster]")).toContainText("Fırça hazırlanamadı");
 await page.locator("[data-action='saveClipStamp']").click();const name=page.getByRole("textbox",{name:"Stamp adı",exact:true});await name.fill("Yol");
 await page.getByRole("button",{name:"Kaydet",exact:true}).click();await expect(name).toHaveValue("Yol");
 const errors=await page.evaluate(()=>(window as unknown as {smartErrors:string[]}).smartErrors);expect(errors.length).toBeGreaterThan(0);expect(errors.join(" ")).not.toMatch(/Error:|proje değişti|debug/);
 expect(await page.evaluate(async()=>{const{useProjectLibrary}=await import(/* @vite-ignore */String("/src/io/projectLibrary.ts"));return useProjectLibrary.getState().stamps.length;})).toBe(0);
});

test("review remedy: 16×24 world defaults cannot override a verified 16×16 road's new map",async({page})=>{
 test.setTimeout(120_000);await mismatch(page);
 await page.evaluate(async()=>{
  const {useProjectLibrary}=await import(/* @vite-ignore */String('/src/io/projectLibrary.ts'));
  const s=useProjectLibrary.getState().settings;useProjectLibrary.getState().setSettings({...s,tileWidth:16,tileHeight:24});
 });
 await dragRoad(page,[[4,4]]);expect((await roadCells(page)).cells).toHaveLength(9);
 await page.locator('[data-smart-grid-remedy]').click();
 const dialog=page.locator('[data-dialog=new-level]');await expect(dialog.getByLabel('Tile boyutu',{exact:true})).toHaveValue('16');
 await dialog.locator("button[type='submit']").click();await expect(dialog).toBeHidden();
 await expect.poll(()=>page.evaluate(async()=>{const {useEditorStore}=await import(/* @vite-ignore */String('/src/state/editorStore.ts'));const m=useEditorStore.getState().project.store.document.map;return [m.tileWidth,m.tileHeight];})).toEqual([16,16]);
 await expect(page.locator('[data-smart-brush]')).toBeChecked();
 await page.locator("canvas[aria-label='map canvas']").first().focus();await page.keyboard.press('b');
 await dragRoad(page,[[4,4],[7,4]]);
 const result=await roadCells(page);expect(result.generated).toHaveLength(1);expect(result.cells).toHaveLength(4);
 expect(result.cells.every(c=>c.tilesetId===result.generated[0]!.id)).toBe(true);await noErrors(page);
});
