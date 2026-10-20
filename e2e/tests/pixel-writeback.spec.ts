import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { confirmTilesetCard, dropFile, expect, readOpfsText, test } from '../support/fixtures';
import type * as Core from '../../packages/core/src/index';
const corePath=`/@fs${fileURLToPath(new URL('../../packages/core/src/index.ts',import.meta.url))}`;
interface Hook { store:Core.MapStore;pixelUi:{getState():{pending:boolean}};pixelColors:{getState():{setFg(value:string):void}};cellCenter(x:number,y:number):{x:number;y:number};setCamera(x:number,y:number,zoom:number):void }
async function read(page:Page,path:string):Promise<number[]> {return page.evaluate(async path=>{let d=await navigator.storage.getDirectory();const parts=path.split('/'),file=parts.pop()!;for(const p of parts)d=await d.getDirectoryHandle(p);return [...new Uint8Array(await(await(await d.getFileHandle(file)).getFile()).arrayBuffer())];},path);}
async function write(page:Page,path:string,bytes:number[]) {await page.evaluate(async({path,bytes})=>{let d=await navigator.storage.getDirectory();const parts=path.split('/'),file=parts.pop()!;for(const p of parts)d=await d.getDirectoryHandle(p,{create:true});const w=await(await d.getFileHandle(file,{create:true})).createWritable();await w.write(new Uint8Array(bytes));await w.close();},{path,bytes});}
async function open(page:Page) {
  await page.goto('/');
  const original=await page.evaluate(async path=>{
    const c=await import(/* @vite-ignore */ path) as typeof Core;
    const ts={id:'source',name:'Source',imagePath:'tilesets/source.png',tileWidth:16,tileHeight:16,columns:2,rows:1,margin:1,spacing:1};
    const s=new c.MapStore(c.createDocument({width:4,height:4,tileWidth:16,tileHeight:16,tilesets:[ts]}));const layerId=s.dispatch({type:'addLayer',layer:{name:'Ground'}});const index=s.getOrAddPaletteIndex('source',0);s.dispatch({type:'paintCells',layerId,cells:[{x:0,y:0,cell:index},{x:1,y:0,cell:index}]});
    const pixels=new Uint8Array(35*18*4).fill(255);for(let y=0;y<18;y++)for(let x=18;x<35;x++)pixels.set([x,y,91,x%3?7:255],(y*35+x)*4);
    const codec=await import(/* @vite-ignore */ String('/src/io/sourcePng.ts'));pixels.set([77,66,55,0],(5*35+5)*4);const png=codec.encodeSourcePng({width:35,height:18,data:pixels}),manifest=c.serializeProject({name:'Writeback',levels:[{id:'a',name:'A',path:'levels/main.json',world:{x:0,y:0}}],tilesets:[ts]});
    for(const[path,data]of[['project.smap',manifest],['levels/main.json',c.serializeLevel(s.document)],['tilesets/source.png',png]] as const){const parts=path.split('/'),file=parts.pop()!;let d=await navigator.storage.getDirectory();for(const p of parts)d=await d.getDirectoryHandle(p,{create:true});const w=await(await d.getFileHandle(file,{create:true})).createWritable();await w.write(typeof data==='string'?data:new Uint8Array(data));await w.close();}return [...png];
  },corePath);
  await page.keyboard.press('Control+o');await expect(page.locator('canvas[aria-label="map canvas"]').first()).toBeVisible();await page.waitForFunction(()=>!!(window as unknown as {__smap:Hook}).__smap?.store);
  await page.evaluate(()=>(window as unknown as {__smap:Hook}).__smap.setCamera(24,48,6));
  await key(page,'m');await expect.poll(()=>page.evaluate(()=>(window as unknown as {__smap:Hook}).__smap.pixelUi.getState().pending)).toBe(false);
  return original;
}
async function key(page:Page,key:string){await page.locator('canvas[aria-label="map canvas"]').first().focus();await page.keyboard.press(key);}
async function edit(page:Page,cellX=0,value='#ff0044ff') {await page.evaluate(value=>(window as unknown as {__smap:Hook}).__smap.pixelColors.getState().setFg(value),value);const p=await page.evaluate(cellX=>{const h=(window as unknown as {__smap:Hook}).__smap,a=h.cellCenter(cellX,0),b=h.cellCenter(cellX+1,0),scale=(b.x-a.x)/16;return{x:a.x+(-8+1.5)*scale,y:a.y+(-8+1.5)*scale};},cellX);await page.mouse.click(p.x,p.y);await expect.poll(()=>page.evaluate(()=>(window as unknown as {__smap:Hook}).__smap.store.document.tilesets.some(t=>t.edited))).toBe(true);}
async function dialog(page:Page,restore=false){await page.getByRole('button',{name:'Görünüm seçenekleri',exact:true}).click();await page.locator(`[data-command="pixel.${restore?'restorePng':'applyPng'}"]`).click();const d=page.locator('[data-png-writeback-dialog]');await expect(d).toBeVisible();await expect(d.getByRole('status').filter({hasText:'Dosyalar denetleniyor'})).toHaveCount(0);return d;}
/** Read RGBA8 PNG from the deterministic fixture or fast-png encoder (all PNG filters). */
function rgba(bytes:number[]):Buffer {const b=Buffer.from(bytes);const w=b.readUInt32BE(16),h=b.readUInt32BE(20),chunks:Buffer[]=[];for(let p=8;p<b.length;){const n=b.readUInt32BE(p);if(b.toString('ascii',p+4,p+8)==='IDAT')chunks.push(b.subarray(p+8,p+8+n));p+=n+12;}const raw=inflateSync(Buffer.concat(chunks)),out=Buffer.alloc(w*h*4),stride=w*4;for(let y=0;y<h;y++){const f=raw[y*(stride+1)]!;for(let x=0;x<stride;x++){const a=x>=4?out[y*stride+x-4]!:0,c=y&&x>=4?out[(y-1)*stride+x-4]!:0,up=y?out[(y-1)*stride+x]!:0;let v=0;if(f===1)v=a;if(f===2)v=up;if(f===3)v=Math.floor((a+up)/2);if(f===4){const p=a+up-c,pa=Math.abs(p-a),pb=Math.abs(p-up),pc=Math.abs(p-c);v=pa<=pb&&pa<=pc?a:pb<=pc?up:c;}out[y*stride+x]=(raw[y*(stride+1)+1+x]!+v)&255;}}return out;}

test('confirmed write-back preserves other pixels and exact backup; reopen/export and confirmed restore retain clones',async({page})=>{
  test.setTimeout(180_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const original=await open(page);await edit(page);
  const d=await dialog(page);await expect(d).toContainText('Bu kaynağı kullanan hücrelerin görünüşü değişir');await expect(d).toContainText('Dünyada 1 hücre');await expect(d.locator('[data-png-destination]')).toHaveText('tilesets/source.png');const backup=(await d.locator('[data-png-backup]').textContent())!;await d.screenshot({path:test.info().outputPath('apply-dialog.png')});
  expect(await read(page,'tilesets/source.png')).toEqual(original);await expect(d.locator('[data-png-confirm]')).toBeEnabled();await d.locator('[data-png-confirm]').click();await expect(d).toBeHidden();
  const current=await read(page,'tilesets/source.png');expect(current).not.toEqual(original);expect(await read(page,backup)).toEqual(original);
  const expected=rgba(original);expected.set([255,0,68,255],(2*35+2)*4);expect(rgba(current)).toEqual(expected);
  const editedBefore=await page.evaluate(()=>{const s=(window as unknown as {__smap:Hook}).__smap.store;return JSON.stringify({level:s.document.palette.entries(),tile:[...s.rasterAssets.getTile('edited-16x16-1',0)!.data]});});
  await key(page,'Control+s');await expect.poll(()=>readOpfsText(page,'project.smap')).toContain('edited-16x16');await page.reload();await page.getByRole('button',{name:/^Aç/}).click();await expect(page.locator('canvas[aria-label="map canvas"]').first()).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>!!(window as unknown as {__smap:Hook}).__smap?.store.rasterAssets.getTile('edited-16x16-1',0))).toBe(true);
  expect(await page.evaluate(()=>{const s=(window as unknown as {__smap:Hook}).__smap.store;return JSON.stringify({level:s.document.palette.entries(),tile:[...s.rasterAssets.getTile('edited-16x16-1',0)!.data]});})).toEqual(editedBefore);
  await key(page,'Control+e');const exportDialog=page.getByRole('dialog');await exportDialog.getByRole('radio',{name:'PNG',exact:true}).click();const downloading=page.waitForEvent('download');await exportDialog.getByTestId('export-submit').click();const exported=[...readFileSync((await(await downloading).path())!)];expect(rgba(exported).subarray((1*64+17)*4,(1*64+17)*4+4)).toEqual(Buffer.from([255,0,68,255]));
  await key(page,'m');const restore=await dialog(page,true);await restore.getByRole('combobox',{name:'PNG yedekleri',exact:true}).selectOption(backup);const restoreBackup=(await restore.locator('[data-png-backup]').textContent())!;await restore.locator('[data-png-confirm]').click();await expect(restore).toBeHidden();expect(await read(page,'tilesets/source.png')).toEqual(original);expect(await read(page,restoreBackup)).toEqual(current);expect(await read(page,backup)).toEqual(original);expect(errors).toEqual([]);
});

test('conflicting clones require an explicit variant; cancel and paint undo do not write the source',async({page})=>{
  test.setTimeout(120_000);const original=await open(page);await edit(page);await edit(page,1,'#00ff00ff');const d=await dialog(page);await expect(d).toContainText('Aynı kaynak tile');await expect(d.locator('[data-png-confirm]')).toBeDisabled();await expect(d.locator('[data-png-variant]')).toHaveCount(2);await d.locator('[data-png-variant]').nth(1).click();await expect(d.locator('[data-png-confirm]')).toBeEnabled();await d.getByRole('button',{name:'Vazgeç',exact:true}).click();expect(await read(page,'tilesets/source.png')).toEqual(original);
  await key(page,'Control+z');expect(await read(page,'tilesets/source.png')).toEqual(original);const next=await dialog(page);await next.locator('[data-png-confirm]').click();await expect(next).toBeHidden();const applied=await read(page,'tilesets/source.png');await key(page,'Control+z');expect(await read(page,'tilesets/source.png')).toEqual(applied);
});

test('disk change after review blocks old confirmation and requires reload, new review and confirmation',async({page})=>{
  test.setTimeout(120_000);await open(page);await edit(page);const d=await dialog(page);const external=await page.evaluate(async path=>{const c=await import(/* @vite-ignore */ path) as typeof Core;const pixels=new Uint8Array(35*18*4).fill(100);for(let i=3;i<pixels.length;i+=4)pixels[i]=255;return [...c.encodeRgbaPng(35,18,pixels)];},corePath);await write(page,'tilesets/source.png',external);expect(await read(page,'tilesets/source.png')).toEqual(external);
  await d.locator('[data-png-confirm]').click();expect(await read(page,'tilesets/source.png')).toEqual(external);await expect(d.getByRole('alert')).toContainText('Eski onayla yazılamaz');await expect(d.locator('[data-png-confirm]')).toBeDisabled();expect(await read(page,'tilesets/source.png')).toEqual(external);await d.getByRole('button',{name:'Yeniden yükle',exact:true}).click();await expect(d).toContainText('Güncel disk pikselleri yüklendi');await expect(d.locator('[data-png-confirm]')).toBeEnabled();const backup=(await d.locator('[data-png-backup]').textContent())!;await d.locator('[data-png-confirm]').click();await expect(d).toBeHidden();expect(await read(page,backup)).toEqual(external);
});

test('expanded composites are listed as not applicable through the command palette',async({page})=>{
  test.setTimeout(120_000);const original=await open(page);await page.evaluate(()=>{const s=(window as unknown as {__smap:Hook}).__smap.store;s.dispatch({type:'allocateEditedTile',tileWidth:32,tileHeight:32,pixels:new Uint8Array(4096),source:{tilesetId:'source',tileId:0,pixelHash:'old'}});});
  await key(page,'Control+k');await page.getByRole('combobox').fill("PNG'ye uygula");await page.keyboard.press('Enter');const d=page.locator('[data-png-writeback-dialog]');await expect(d).toBeVisible();await expect(d.locator('[data-png-unsupported]')).toContainText('ölçüsü');await expect(d.locator('[data-png-confirm]')).toBeDisabled();expect(await read(page,'tilesets/source.png')).toEqual(original);
});

test('edited tileset context opens the shared dialog; source context lists its backups',async({page})=>{
  test.setTimeout(120_000);const original=await open(page);await edit(page);
  await page.locator('[data-tileset-switcher]').click();await page.locator('[data-tileset-option="edited-16x16-1"]').click();await page.locator('[data-tileset-switcher]').click({button:'right'});
  await page.locator('[data-tileset-menu-item="apply-png"]').click();const d=page.locator('[data-png-writeback-dialog]');await expect(d).toBeVisible();await expect(d.locator('[data-png-confirm]')).toBeEnabled();await d.locator('[data-png-confirm]').click();await expect(d).toBeHidden();
  await page.locator('[data-tileset-switcher]').click();await page.locator('[data-tileset-option="source"]').click();await page.locator('[data-tileset-switcher]').click({button:'right'});await page.locator('[data-tileset-menu-item="restore-png"]').click();await expect(d).toBeVisible();const backups=d.getByRole('combobox',{name:'PNG yedekleri',exact:true});await expect(backups.locator('option')).toHaveCount(2);await backups.selectOption({index:1});await d.locator('[data-png-confirm]').click();await expect(d).toBeHidden();expect(await read(page,'tilesets/source.png')).toEqual(original);
});

test('image replacement uses a separate revision, keeps original PNG bytes, and undo/redo restores equal-size images',async({page})=>{
  test.setTimeout(180_000);const original=await open(page);
  const replacement=await page.evaluate(async path=>{const c=await import(/* @vite-ignore */ path) as typeof Core;const data=new Uint8Array(35*18*4);for(let p=0;p<data.length;p+=4)data.set([20,80,120,255],p);return [...c.encodeRgbaPng(35,18,data)];},corePath);
  await page.locator('[data-tileset-switcher]').click({button:'right'});const choosing=page.waitForEvent('filechooser');await page.locator('[data-tileset-menu-item="image"]').click();await(await choosing).setFiles({name:'replacement.png',mimeType:'image/png',buffer:Buffer.from(replacement)});
  const path=()=>page.evaluate(()=>(window as unknown as {__smap:Hook}).__smap?.store.document.getTileset('source')?.imagePath??null);
  await expect.poll(path).toMatch(/^tilesets\/image-/);const revision=(await path())!;await key(page,'Control+s');await expect.poll(()=>read(page,revision).catch(()=>null)).toEqual(replacement);expect(await read(page,'tilesets/source.png')).toEqual(original);
  await key(page,'Control+z');await expect.poll(path).toBe('tilesets/source.png');
  const registered=()=>page.evaluate(async()=>{const m=await import(/* @vite-ignore */ String('/src/state/tilesetImages.ts'));return [...(m.getTilesetImage('source')?.bytes??[])];});
  await expect.poll(registered).toEqual(original);await key(page,'Control+Shift+z');await expect.poll(path).toBe(revision);await expect.poll(registered).toEqual(replacement);
  await key(page,'Control+s');await page.reload();await page.getByRole('button',{name:/^Aç/}).click();await expect(page.locator('canvas[aria-label="map canvas"]').first()).toBeVisible();await expect.poll(path).toBe(revision);await expect.poll(registered).toEqual(replacement);expect(await read(page,'tilesets/source.png')).toEqual(original);
});

test('an edited tile copied with the Tile brush and edited again remains an applicable conflicting variant',async({page})=>{
  test.setTimeout(120_000);const original=await open(page);await edit(page);await key(page,'m');await key(page,'i');
  const a=await page.evaluate(()=>(window as unknown as {__smap:Hook}).__smap.cellCenter(0,0));await page.mouse.click(a.x,a.y);await key(page,'b');
  const b=await page.evaluate(()=>(window as unknown as {__smap:Hook}).__smap.cellCenter(1,0));await page.mouse.click(b.x,b.y);await key(page,'m');await edit(page,1,'#0000ffff');
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__smap:Hook}).__smap.store.document.getTileset('edited-16x16-1')!.edited!.nextTileId)).toBe(2);
  const d=await dialog(page);await expect(d.locator('[data-png-unsupported]')).toHaveCount(0);await expect(d.locator('[data-png-confirm]')).toBeDisabled();await d.locator('[data-png-variant]').nth(1).click();await d.locator('[data-png-confirm]').click();await expect(d).toBeHidden();
  const expected=rgba(original);expected.set([0,0,255,255],(2*35+2)*4);expect(rgba(await read(page,'tilesets/source.png'))).toEqual(expected);
});

test('import reserves an orphan source PNG name and saves the new pixels under a separate path',async({page})=>{
  test.setTimeout(120_000);const original=await open(page);await key(page,'m');await write(page,'tilesets/reimport.png',original);
  const replacement=await page.evaluate(async path=>{const c=await import(/* @vite-ignore */ path) as typeof Core;const data=new Uint8Array(16*16*4).fill(255);data.set([1,2,3,255]);return [...c.encodeRgbaPng(16,16,data)];},corePath);
  await dropFile(page,'canvas[aria-label="map canvas"]','reimport.png',replacement);await confirmTilesetCard(page);
  const imported=await page.evaluate(()=>(window as unknown as {__smap:Hook}).__smap.store.document.tilesets.find(t=>t.name==='reimport')!);expect(imported.imagePath).not.toBe('tilesets/reimport.png');
  await key(page,'Control+s');await expect.poll(()=>read(page,imported.imagePath).catch(()=>null)).toEqual(replacement);expect(await read(page,'tilesets/reimport.png')).toEqual(original);
  await page.reload();await page.getByRole('button',{name:/^Aç/}).click();await page.waitForFunction(()=>!!(window as unknown as {__smap:Hook}).__smap?.store);expect(await page.evaluate(id=>(window as unknown as {__smap:Hook}).__smap.store.document.getTileset(id)!.imagePath,imported.id)).toBe(imported.imagePath);expect(await read(page,imported.imagePath)).toEqual(replacement);
});
