import { readFileSync } from "node:fs";
import { test, expect, expectWelcome } from "../support/fixtures";
import { selectRoad, dragRoad, roadCells } from "../support/smartStampDock";

const fixture=(name:string)=>[...readFileSync(new URL(`../../packages/core/test/fixtures/v16-selection/${name}`,import.meta.url))];
for(const version of [4,5])test(`frozen format ${version} selection reuses its layout-1 atlas and joins the pre-upgrade road`,async({page})=>{
 await page.goto("/");await expectWelcome(page);
 const files=[{path:"project.smap",bytes:fixture("project.smap")},{path:"levels/main.json",bytes:fixture("main.json")},{path:"tilesets/generated-selection-ea78d74d-1.recipe.json",bytes:fixture("recipe.json")},{path:"tilesets/smart-road-32.png",bytes:fixture("source.png")},{path:"tilesets/generated-selection-ea78d74d-1.png",bytes:fixture("baked.png")}];
 await page.evaluate(async({files,version})=>{
  const root=await navigator.storage.getDirectory();
  for(const file of files){const parts=file.path.split("/"),name=parts.pop()!;let dir=root;for(const part of parts)dir=await dir.getDirectoryHandle(part,{create:true});const writer=await(await dir.getFileHandle(name,{create:true})).createWritable();
   const bytes=new Uint8Array(file.bytes);await writer.write(version===5&&!file.path.endsWith(".png")?new TextDecoder().decode(bytes).replaceAll('"documentFormatVersion": 4','"documentFormatVersion": 5'):bytes);await writer.close();}
 },{files,version});
 await page.keyboard.press("Control+o");await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>Object.hasOwn(window,"__smap"))).toBe(true);
 await page.evaluate(()=>(window as unknown as {__smap:{setCamera(x:number,y:number,z:number):void}}).__smap.setCamera(24,24,1));
 const before=await roadCells(page);expect(before.cells.map(c=>c.tileId)).toEqual([12,31,29]);
 await selectRoad(page);await expect(page.locator("[data-smart-brush]")).toBeChecked();await dragRoad(page,[[7,4],[8,4]]);
 const after=await roadCells(page);expect(after.generated).toEqual(before.generated);expect(after.generated).toHaveLength(1);
 expect(after.cells.map(c=>c.tileId)).toEqual([12,31,31,13,14]);expect(new Set(after.cells.map(c=>c.tilesetId))).toEqual(new Set([before.generated[0]!.id]));
 await page.keyboard.press("Control+z");expect(await roadCells(page)).toEqual(before);await page.keyboard.press("Control+y");expect(await roadCells(page)).toEqual(after);
});
