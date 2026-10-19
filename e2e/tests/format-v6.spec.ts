import { fileURLToPath } from 'node:url';
import { expect, readOpfsText, test } from '../support/fixtures';
import type * as Core from '../../packages/core/src/index';
const corePath = `/@fs${fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))}`;

test('opens, exports and saves a v6 edited PNG-backed tileset with stable metadata and collection rows', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const expected = await page.evaluate(async path => {
    const core = await import(/* @vite-ignore */ path) as typeof Core;
    const store = new core.MapStore(core.createDocument({ width: 4, height: 4, tileWidth: 16, tileHeight: 16 }));
    const layerId = store.dispatch({ type: 'addLayer', layer: { name: 'Tiles' } });
    const pixels = new Uint8Array(16*16*4);
    for (let p=0;p<pixels.length;p+=4) pixels.set([32,96,144,255],p);
    const slot = store.dispatch({ type: 'allocateEditedTile', tileWidth: 16, tileHeight: 16, pixels });
    store.dispatch({ type: 'remapCells', layerId, cells: [{x:1,y:1}], tilesetId: slot.assetId, tileId: slot.tileId });
    store.dispatch({ type: 'setCollection', collection: {id:'favs',name:'Favorites',columns:4,rows:8,cells:[{x:0,y:0,tilesetId:slot.assetId,tileId:0}]} });
    const image = store.rasterAssets.getAsset(slot.assetId)!;
    const ts = store.document.tilesets[0]!;
    const project = core.serializeProject({ name:'Pixel format fixture', levels:[{name:'Main',path:'levels/main.json'}], tilesets:store.document.tilesets, collections:store.document.collections });
    const files = [
      {path:'project.smap',data:project},
      {path:'levels/main.json',data:core.serializeLevel(store.document)},
      {path:ts.imagePath,data:core.encodeRgbaPng(image.width,image.height,image.data)},
    ];
    const root = await navigator.storage.getDirectory();
    for(const file of files){const parts=file.path.split('/'),name=parts.pop()!;let dir=root;for(const part of parts)dir=await dir.getDirectoryHandle(part,{create:true});const writer=await(await dir.getFileHandle(name,{create:true})).createWritable();await writer.write(typeof file.data==='string'?file.data:new Uint8Array(file.data));await writer.close();}
    return {edited:ts.edited,imagePath:ts.imagePath};
  }, corePath);
  await page.keyboard.press('Control+o');
  const canvas=page.locator("canvas[aria-label='map canvas']").first();
  await expect(canvas).toBeVisible({timeout:30_000});
  await canvas.focus();await page.keyboard.press('Control+e');
  const dialog=page.getByRole('dialog');await dialog.getByRole('radio',{name:'JSON',exact:true}).click();
  const download=page.waitForEvent('download');await dialog.getByTestId('export-submit').click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await canvas.focus();await page.keyboard.press('Control+s');
  await expect.poll(async()=>{
    const text=await readOpfsText(page,'project.smap');
    if(text===null)return null; // Atomic replacement can briefly hide the file.
    const saved=JSON.parse(text);
    return {version:saved.documentFormatVersion,edited:saved.tilesets[0].edited,imagePath:saved.tilesets[0].imagePath,rows:saved.collections[0].rows};
  }).toEqual({version:6,edited:expected.edited,imagePath:expected.imagePath,rows:8});
});
