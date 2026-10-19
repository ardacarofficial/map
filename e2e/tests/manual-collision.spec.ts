import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expect, readOpfsText, startWithTileset, test } from "../support/fixtures";

const canvas = (page: Page) => page.locator("canvas[aria-label='map canvas']").first();
async function at(page: Page, x: number, y: number) {
  return page.evaluate(({x,y}) => (window as unknown as {__smap:{cellCenter(x:number,y:number):{x:number;y:number}}}).__smap.cellCenter(x,y), {x,y});
}
async function values(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const s=useEditorStore.getState(), layer=s.project.store.document.getLayer(s.activeLayerId);
    return [layer.getCell(28,24),layer.getCell(29,24)];
  });
}

test("manual Collision paints Engel/Geçilebilir, undoes, exports game JSON and invisible TMJ rectangles", async ({page}) => {
  await page.goto("/"); await startWithTileset(page);
  await page.getByRole("button",{name:"Katman ekle",exact:true}).click();
  await page.getByRole("menuitem",{name:"Collision katmanı",exact:true}).click();
  await expect(page.locator("[data-inspector-collision]")).toBeVisible();
  await page.getByRole("radio",{name:"Engel",exact:true}).click();
  const a=await at(page,28,24), b=await at(page,29,24);
  await page.mouse.click(a.x,a.y);
  await page.getByRole("radio",{name:"Geçilebilir",exact:true}).click();
  await page.mouse.click(b.x,b.y);
  await expect.poll(()=>values(page)).toEqual([1,2]);
  await canvas(page).focus(); await page.keyboard.press("Control+z");
  await expect.poll(()=>values(page)).toEqual([1,0]);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(()=>values(page)).toEqual([1,2]);

  await page.keyboard.press("Control+e");
  const dialog=page.getByRole("dialog");
  await dialog.getByRole("radio",{name:"JSON",exact:true}).click();
  const downloaded=page.waitForEvent("download"); await dialog.getByTestId("export-submit").click();
  const map=JSON.parse(readFileSync((await (await downloaded).path())!,"utf8"));
  const blocked: boolean[]=[];let value=false;for(const run of map.collision.solid){for(let i=0;i<run;i++)blocked.push(value);value=!value;}
  expect(map.smapExport).toBe(1);expect(blocked.filter(Boolean)).toHaveLength(1);expect(blocked[24*map.width+28]).toBe(true);expect(blocked[24*map.width+29]).toBe(false);
  await expect(dialog).toBeHidden();
  await canvas(page).focus(); await page.keyboard.press("Control+e");
  await dialog.getByRole("radio",{name:"Tiled",exact:true}).click();
  await dialog.getByTestId("export-submit").click();
  await expect.poll(()=>readOpfsText(page,"Ana harita.tmj")).not.toBeNull();
  const tmj=JSON.parse((await readOpfsText(page,"Ana harita.tmj"))!);
  const collision=tmj.layers.find((l:{properties?:{name:string;value:string}[]})=>l.properties?.some(p=>p.name==="smapRole"&&p.value==="collision"));
  expect(collision).toMatchObject({type:"objectgroup",name:"Collision",visible:false});
  expect(collision.objects).toHaveLength(1);expect(collision.objects[0]).toMatchObject({x:28*32,y:24*32,width:32,height:32,visible:false});
  expect(tmj.tilesets.every((t:{tiles?:unknown})=>!t.tiles)).toBe(true);
});
