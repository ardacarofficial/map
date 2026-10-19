import type { Page } from "@playwright/test";
import { expect,test,readOpfsText } from "../support/fixtures";
import { openRoadSheet,selectRoad,saveRoad,dragRoad,roadCells,waitForSaveIdle } from "../support/smartStampDock";
import { cellPoint } from "../support/smartStamp";
const masks=[0,1,4,5,7,16,17,20,21,23,28,29,31,64,65,68,69,71,80,81,84,85,87,92,93,95,112,113,116,117,119,124,125,127,193,197,199,209,213,215,221,223,241,245,247,253,255];
async function ghost(page:Page){return page.evaluate(()=> (window as unknown as {__smap:{smartPreview:{layers:{writes:{x:number;y:number;tile:{tileId:number;tilesetId:string};flags?:number}[]}[]}|null}}).__smap.smartPreview?.layers.flatMap(l=>l.writes).map(w=>({x:w.x,y:w.y,...w.tile,flags:w.flags??0}))??[]);}
async function rect(page:Page,x:number,y:number,w:number,h:number){
 const a=await cellPoint(page,x,y),z=await cellPoint(page,x+w-1,y+h-1);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(z.x,z.y);
 await expect.poll(async()=>(await ghost(page)).length).toBe(w*h);const preview=await ghost(page);await page.mouse.up();
 expect((await roadCells(page)).cells).toEqual(preview);return preview;
}
for(const [size,saved,flip]of [[16,false,false],[32,false,false],[32,true,false],[32,false,true]]as const)test(`${size}px ${saved?"saved":"direct"} ${flip?"X":"canonical"}: thick road straight, L, T, + and one undo`,async({page})=>{
 await openRoadSheet(page,size,"-thick");await selectRoad(page,6,6);await expect(page.locator("[data-smart-brush]")).toBeChecked();await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();
 if(saved)await saveRoad(page);if(flip)await page.keyboard.press("x");
 const p=await cellPoint(page,5,5);await page.mouse.move(p.x,p.y);await expect.poll(async()=>(await ghost(page)).length).toBe(4);const preview=await ghost(page);
 await page.mouse.down();await page.mouse.up();expect((await roadCells(page)).cells).toEqual(preview);
 await page.keyboard.press("Control+z");expect((await roadCells(page)).cells).toHaveLength(0);if(!saved)expect((await roadCells(page)).generated).toHaveLength(0);
 await dragRoad(page,[[5,5],[13,5]]);const straight=await roadCells(page);expect(straight.cells).toHaveLength(20);
 expect(straight.cells.every(c=>c.y===4||c.y===5)).toBe(true);
 if(!flip)for(const c of straight.cells){const mask=c.x<6?4:c.x>=12?64:68;expect(c.tileId).toBe(144+masks.indexOf(mask)*4+(c.y-4)*2+c.x%2);}
 await page.keyboard.press("Control+z");expect((await roadCells(page)).cells).toHaveLength(0);await page.keyboard.press("Control+y");expect(await roadCells(page)).toEqual(straight);
 await dragRoad(page,[[13,5],[13,15],[17,15]]);await dragRoad(page,[[9,1],[9,11]]);await dragRoad(page,[[13,9],[17,9]]);
 const result=await roadCells(page);expect(result.generated).toHaveLength(1);
 if(!flip){for(const [x,y,mask]of [[12,14,5],[12,8,21],[8,4,85],[16,14,64]])for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)expect(result.cells.find(c=>c.x===x!+dx&&c.y===y!+dy)?.tileId).toBe(144+masks.indexOf(mask!)*4+dy*2+dx);}
 // Read-only pixel oracle: horizontal road takes north/south macro quarters, including marker pixels.
 expect(await page.evaluate(async({size,flip})=>{
  const {getTilesetImage}=await import(/* @vite-ignore */String("/src/state/tilesetImages.ts"));const{useEditorStore}=await import(/* @vite-ignore */String("/src/state/editorStore.ts"));const doc=useEditorStore.getState().project.store.document,bank=doc.tilesets.find((t:{generated?:unknown})=>t.generated);
  const image=(id:string)=>{const bmp=getTilesetImage(id).bitmap,c=new OffscreenCanvas(bmp.width,bmp.height),ctx=c.getContext("2d")!;ctx.drawImage(bmp,0,0);return {width:bmp.width,data:ctx.getImageData(0,0,bmp.width,bmp.height).data};};
  const src=image(`smart-road-${size}`),dst=image(bank.id),base=204; // mask 68 rank 15
  for(let y=0;y<2*size;y++)for(let x=0;x<2*size;x++)for(let c=0;c<4;c++){
   const slot=base+Math.floor(y/size)*2+Math.floor(x/size),a=(((y<size?1:5)*size+y)*src.width+4*size+x)*4+c,b=((Math.floor(slot/bank.columns)*size+y%size)*dst.width+(slot%bank.columns)*size+x%size)*4+c;
   if(src.data[a]!==dst.data[b])return false;
  }
  const cell=doc.getLayer(useEditorStore.getState().activeLayerId).getCell(10,4);return ((cell&0xe0000000)>>>0)===(flip?0x80000000:0);
 },{size,flip})).toBe(true);
});
for(const [size,variant,n,saved]of [[16,"-thick",6,false],[32,"-thick",6,false],[32,"-thick-wide",8,false],[32,"-thick",6,true],[32,"-thick-odd",7,false]]as const)test(`${size}px ${saved?"saved":"direct"} ${n}×6: R area caps, non-square phase, B Alan and X preview`,async({page})=>{
 await openRoadSheet(page,size,variant);await selectRoad(page,n,6);await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();if(saved)await saveRoad(page);await page.keyboard.press("r");
 for(const [w,h]of [[1,1],[1,7],[2,3],[3,2],[3,3],[4,4],[5,7],[9,6]]){const cells=await rect(page,4,4,w!,h!);if(w!>=4&&h!>=4){expect(cells[0]!.tileId).toBe(0);expect(cells[w!-1]!.tileId).toBe(n-1);expect(cells.at(-1)!.tileId).toBe(6*n-1);}await page.keyboard.press("Control+z");expect((await roadCells(page)).cells).toHaveLength(0);}
 await page.keyboard.press("x");await rect(page,4,4,3,5);await page.keyboard.press("Control+z");await page.keyboard.press("b");await page.getByRole("radio",{name:"Alan",exact:true}).click();await rect(page,4,4,5,3);
});
test("thick saved Akıllı off stays a plain 6×6 block after save/reload",async({page})=>{
 await openRoadSheet(page,32,"-thick");await selectRoad(page,6,6);await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();await page.locator("[data-smart-brush]").click();await saveRoad(page);await dragRoad(page,[[6,6]]);
 const before=await roadCells(page);expect(before.cells).toHaveLength(36);expect(before.cells.every(c=>c.tilesetId==="smart-road-32")).toBe(true);
 await page.keyboard.press("Control+s");await expect.poll(()=>readOpfsText(page,"stamps/koy-yolu.json")).not.toBeNull();const disk=JSON.parse((await readOpfsText(page,"stamps/koy-yolu.json"))!);expect(disk.smartDisabled).toBe(true);expect(disk.nineSlice.border).toBe(2);
 await waitForSaveIdle(page);await page.reload();await page.getByRole("button",{name:/^Aç…/}).click();await page.locator("[data-panel-tab='stamps']").click();await page.locator("[data-stamp-id='koy-yolu']").dblclick();await expect(page.locator("[data-smart-brush]")).not.toBeChecked();expect((await roadCells(page)).cells).toEqual(before.cells);await page.keyboard.press("b");await dragRoad(page,[[16,6]]);expect((await roadCells(page)).cells).toHaveLength(72);await page.keyboard.press("Control+z");await page.locator("[data-smart-brush]").click();await dragRoad(page,[[16,6],[19,6]]);expect((await roadCells(page)).cells).toHaveLength(44);
});
test("thick map border uses authored band corners and edges, gaps, preview and one undo",async({page})=>{
 await openRoadSheet(page,32,"-thick");await selectRoad(page,6,6);await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();
 await page.getByRole("menuitem",{name:"Harita",exact:true}).click();await page.getByRole("menuitem",{name:"Kenar…",exact:true}).click();const dialog=page.locator("[data-map-border-dialog]");await dialog.getByRole("spinbutton",{name:"Kalınlık",exact:true}).fill("2");
 await dialog.getByRole("button",{name:"Boşluk ekle"}).click();await dialog.getByRole("spinbutton",{name:"Başlangıç",exact:true}).fill("4");await dialog.getByRole("spinbutton",{name:"Uzunluk",exact:true}).fill("2");
 await expect.poll(async()=>{const cells=await ghost(page);return cells.some(c=>c.x===0&&c.y===0)&&!cells.some(c=>(c.x===4||c.x===5)&&c.y<2);}).toBe(true);const preview=await ghost(page);expect(preview.find(c=>c.x===0&&c.y===0)?.tileId).toBe(0);expect(preview.find(c=>c.x===1&&c.y===1)?.tileId).toBe(7);expect(preview.find(c=>c.x===2&&c.y===0)?.tileId).toBe(2);
 await dialog.getByRole("button",{name:"Uygula",exact:true}).click();const actual=(await roadCells(page)).cells;expect(actual).toHaveLength(428);for(const p of preview)expect(actual).toContainEqual(p);
 await page.locator("canvas[aria-label='map canvas']").first().focus();await page.keyboard.press("Control+z");expect(await roadCells(page)).toEqual({cells:[],generated:[]});
});

test("thick road: Shift bridges macro cells, rotation preview, erase repairs and locked/hidden layers",async({page})=>{
 await openRoadSheet(page,32,"-thick");await selectRoad(page,6,6);await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();
 const layer=page.locator("[data-layer-id]").first();await layer.getByRole("button",{name:"Kilitle",exact:true}).click();await dragRoad(page,[[4,4],[9,4]]);expect(await roadCells(page)).toEqual({cells:[],generated:[]});await expect(page.locator("[data-toaster]")).toContainText("katmanı kilitli");
 await layer.getByRole("button",{name:"Kilidi aç",exact:true}).click();await layer.getByRole("button",{name:"Gizle",exact:true}).click();await dragRoad(page,[[4,4]]);expect(await roadCells(page)).toEqual({cells:[],generated:[]});await layer.getByRole("button",{name:"Göster",exact:true}).click();
 await dragRoad(page,[[5,5]]);const p=await cellPoint(page,13,5);await page.keyboard.down("Shift");await page.mouse.click(p.x,p.y);await page.keyboard.up("Shift");expect((await roadCells(page)).cells).toHaveLength(20);
 await page.keyboard.press("e");await dragRoad(page,[[9,5]]);const erased=(await roadCells(page)).cells;expect(erased).toHaveLength(16);expect(erased.filter(c=>c.x===6||c.x===7).map(c=>c.tileId)).toEqual([196,197,198,199]); // surviving west cap: mask 64
 await page.keyboard.press("Control+z");expect((await roadCells(page)).cells).toHaveLength(20);
 await page.keyboard.press("b");await page.keyboard.press("z");const q=await cellPoint(page,13,9);await page.mouse.move(q.x,q.y);await expect.poll(async()=>(await ghost(page)).length).toBe(4);const rotated=await ghost(page);await page.mouse.click(q.x,q.y);for(const c of rotated)expect((await roadCells(page)).cells).toContainEqual(c);expect(rotated.every(c=>c.flags!==0)).toBe(true);
});
test("thick non-square road reuses its recipe after reselection and reopens with the same generated slots",async({page})=>{
 await openRoadSheet(page,32,"-thick-wide");await selectRoad(page,8,6);await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();await dragRoad(page,[[4,4],[9,4]]);const first=await roadCells(page);expect(first.cells).toHaveLength(12);
 // W=8,H=6,b=2: bank=48+6*(8+6)+36=168.
 expect(first.cells.map(c=>c.tileId)).toEqual([176,177,228,229,220,221,178,179,230,231,222,223]);
 await selectRoad(page,8,6);await dragRoad(page,[[14,4],[17,4]]);expect((await roadCells(page)).generated).toEqual(first.generated);const before=await roadCells(page);
 await page.keyboard.press("Control+s");await expect.poll(()=>readOpfsText(page,"project.smap")).not.toBeNull();await waitForSaveIdle(page);await page.reload();await page.getByRole("button",{name:/^Aç…/}).click();await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();expect(await roadCells(page)).toEqual(before);
});

test("thick road brush size counts macro units and R Yol snaps its rectangle",async({page})=>{
 await openRoadSheet(page,32,"-thick");await selectRoad(page,6,6);await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Boyut",exact:true}).click();await page.getByRole("menuitem",{name:"3 × 3",exact:true}).click();
 await dragRoad(page,[[9,9]]);const wide=(await roadCells(page)).cells;expect(wide).toHaveLength(36);expect(Math.min(...wide.map(c=>c.x))).toBe(6);expect(Math.max(...wide.map(c=>c.x))).toBe(11);
 await page.keyboard.press("Control+z");await page.keyboard.press("r");await page.getByRole("radio",{name:"Yol",exact:true}).click();await dragRoad(page,[[5,5],[8,8]]);const rectangle=(await roadCells(page)).cells;expect(rectangle).toHaveLength(36);expect(Math.min(...rectangle.map(c=>c.x))).toBe(4);expect(Math.max(...rectangle.map(c=>c.x))).toBe(9);
});

test("offset 7×6 b=2 road wraps centre segments, joins strokes and survives save/reopen",async({page})=>{
 await openRoadSheet(page,32,"-thick-odd");await selectRoad(page,7,6);await expect(page.getByRole("radio",{name:"Yol",exact:true})).toBeVisible();
 await dragRoad(page,[[4,4],[7,4]]);await dragRoad(page,[[8,4],[11,4]]);
 const result=await roadCells(page),bank=7*6+6*(7+6)+36;expect(result.generated).toHaveLength(1);expect(result.cells).toHaveLength(16);
 for(const c of result.cells){const mask=c.x<6?4:c.x>=10?64:68;expect(c.tileId).toBe(bank+masks.indexOf(mask)*4+(c.y-4)*2+c.x%2);}
 await page.keyboard.press("Control+s");await expect.poll(()=>readOpfsText(page,"project.smap")).not.toBeNull();await waitForSaveIdle(page);await page.reload();await page.getByRole("button",{name:/^Aç…/}).click();await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();expect(await roadCells(page)).toEqual(result);
 await selectRoad(page,7,6);await dragRoad(page,[[12,4],[15,4]]);expect((await roadCells(page)).generated).toEqual(result.generated);expect((await roadCells(page)).cells.find(c=>c.x===10&&c.y===4)?.tileId).toBe(bank+masks.indexOf(68)*4);
});

for(const size of [16,32])test(`${size}px nonperiodic stone floor remains a plain block through real tileset selection`,async({page})=>{
 await openRoadSheet(page,size,"-material-stone");await selectRoad(page,6,6);
 await expect(page.getByRole("radio",{name:"Yol",exact:true})).toHaveCount(0);
 await dragRoad(page,[[6,6]]);const result=await roadCells(page);
 expect(result.generated).toEqual([]);expect(result.cells).toHaveLength(36);
 expect(result.cells.map(c=>({tilesetId:c.tilesetId,tileId:c.tileId,flags:c.flags}))).toEqual(Array.from({length:36},(_,i)=>({tilesetId:`smart-road-${size}`,tileId:(1+Math.floor(i/6))*12+2+i%6,flags:0})));
 await page.keyboard.press("Control+z");expect((await roadCells(page)).cells).toEqual([]);
});
