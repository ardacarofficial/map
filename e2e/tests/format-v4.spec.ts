import { readFileSync } from "node:fs";
import { expect, readOpfsText, test } from "../support/fixtures";
const fixture=(name:string)=>readFileSync(new URL(`../../packages/core/test/fixtures/v15/${name}`,import.meta.url));

test("opens frozen v3 terrain/solid project with zero PNG pixel difference and no removed UI", async ({page}) => {
  await page.goto("/");
  const project=JSON.parse(fixture("v3-project.json").toString()), level=JSON.parse(fixture("v3-level.json").toString());
  const files=[{path:"project.smap",bytes:[...fixture("v3-project.json")]},{path:"levels/main.json",bytes:[...fixture("v3-level.json")]},{path:"stamps/road.json",bytes:[...fixture("v3-stamp.json")]},{path:"tilesets/baked.recipe.json",bytes:[...fixture("v3-stamp.json")]},{path:"tilesets/source.png",bytes:[...fixture("v3-source.png")]},{path:"tilesets/baked.png",bytes:[...fixture("v3-baked.png")]}];
  // Independent raw-disk oracle: read the frozen Uint32 chunks directly, without any parser/migration/solver.
  const expected=await page.evaluate(async ({files,project,level})=>{
    const root=await navigator.storage.getDirectory();
    for(const {path,bytes} of files){const parts=path.split("/"),name=parts.pop()!;let dir=root;for(const part of parts)dir=await dir.getDirectoryHandle(part,{create:true});const w=await(await dir.getFileHandle(name,{create:true})).createWritable();await w.write(new Uint8Array(bytes));await w.close();}
    const images=new Map<string,ImageBitmap>();
    for(const ts of project.tilesets){const f=files.find(f=>f.path===ts.imagePath)!;images.set(ts.id,await createImageBitmap(new Blob([new Uint8Array(f.bytes)],{type:"image/png"})));}
    const c=new OffscreenCanvas(level.map.width*32,level.map.height*32),ctx=c.getContext("2d")!;ctx.imageSmoothingEnabled=false;
    for(const layer of level.layers){if(layer.type!=="tile"||!layer.visible||layer.opacity<=0)continue;ctx.globalAlpha=layer.opacity;
      for(const chunk of layer.chunks){const raw=Uint8Array.from(atob(chunk.data),(c:string)=>c.charCodeAt(0)),view=new DataView(raw.buffer);
        for(let i=0;i<1024;i++){const cell=view.getUint32(i*4,true);if(!cell)continue;const entry=level.palette[(cell&0x1fffffff)-1],ts=project.tilesets.find((t:{id:string})=>t.id===entry.tilesetId);
          const h=!!(cell&0x80000000),v=!!(cell&0x40000000),d=!!(cell&0x20000000),x=(chunk.cx*32+(i&31))*32,y=(chunk.cy*32+(i>>5))*32;
          ctx.setTransform(d?0:h?-1:1,d?v?-1:1:0,d?h?-1:1:0,d?0:v?-1:1,h?x+32:x,v?y+32:y);
          ctx.drawImage(images.get(ts.id)!,ts.margin+entry.tileId%ts.columns*(32+ts.spacing),ts.margin+Math.floor(entry.tileId/ts.columns)*(32+ts.spacing),32,32,0,0,32,32);
        }
      }
    }
    const pixels=ctx.getImageData(0,0,c.width,c.height).data;
    (window as unknown as {__legacyPixels:Uint8ClampedArray}).__legacyPixels=pixels;
    return pixels.length;
  },{files,project,level});
  await page.keyboard.press("Control+o");
  const canvas=page.locator("canvas[aria-label='map canvas']").first();await expect(canvas).toBeVisible();
  await expect(page.locator("[data-tileset-side]")).toBeVisible();
  await expect(page.locator("[data-tileset-modes], [data-inspector-terrain], [data-inspector-solid], [data-tool-option=terrain]")).toHaveCount(0);
  await expect(page.getByText(/^(Katı|Arazi)$/)).toHaveCount(0);
  await canvas.focus();await page.keyboard.press("Control+k");
  const palette=page.getByRole("combobox");await expect(palette).toBeVisible();
  for(const query of ["arazi","katı"]){await palette.fill(query);await expect(page.getByRole("option").filter({hasText:/Katı|Arazi/})).toHaveCount(0);}
  await page.keyboard.press("Escape");await canvas.focus();await page.keyboard.press("Control+e");
  const dialog=page.getByRole("dialog");await dialog.getByRole("radio",{name:"PNG",exact:true}).click();
  const downloaded=page.waitForEvent("download");await dialog.getByTestId("export-submit").click();
  const bytes=[...readFileSync((await(await downloaded).path())!)];
  const diff=await page.evaluate(async({bytes,expected})=>{const bmp=await createImageBitmap(new Blob([new Uint8Array(bytes)]));const c=new OffscreenCanvas(bmp.width,bmp.height),ctx=c.getContext("2d")!;ctx.drawImage(bmp,0,0);const actual=ctx.getImageData(0,0,bmp.width,bmp.height).data;return actual.length!==expected?-1:actual.reduce((n,v,i)=>n+(v!==(window as unknown as {__legacyPixels:Uint8ClampedArray}).__legacyPixels[i]?1:0),0);},{bytes,expected});
  expect(diff).toBe(0);
  // No eager rewrite of the old file; ordinary save writes format 4 and keeps source atlas bytes.
  expect(JSON.parse((await readOpfsText(page,"project.smap"))!).documentFormatVersion).toBe(3);
  await canvas.focus();await page.keyboard.press("Control+s");
  await expect.poll(async()=>JSON.parse((await readOpfsText(page,"project.smap"))!).documentFormatVersion).toBe(5);
});
