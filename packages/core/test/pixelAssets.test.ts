import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
// eslint-disable-next-line no-restricted-imports -- independent PNG decoder in tests
import { inflateSync } from 'node:zlib';
// eslint-disable-next-line no-restricted-imports -- independent content hash oracle
import { createHash } from 'node:crypto';
import { decodePng } from './png';
import { canonicalRgba, createDocument, MapStore, RasterAssets, encodeRgbaPng, rasterContentHash, serializeLevel, serializeProject, parseProject, isGeneratedAsset, FLIP_H, makeCell } from '../src';

function setup() {
  const rasters = new RasterAssets();
  const store = new MapStore(createDocument({ width: 8, height: 8 }), { rasterAssets: rasters });
  const layerId = store.dispatch({ type: 'addLayer', layer: { name: 'Tiles' } });
  store.clearHistory();
  return { store, rasters, layerId };
}
const rgba = (r: number) => new Uint8Array([r, 2, 3, 255]);

describe('owned raster transactions', () => {
  it('groups allocation, palette, remap and pixels; undo/redo restores exact ids and bytes', () => {
    const { store, rasters, layerId } = setup();
    const initial = serializeLevel(store.document);
    store.beginTransaction('Pixel');
    const slot = store.dispatch({ type: 'allocateEditedTile', tileWidth: 1, tileHeight: 1, pixels: rgba(4), source: { tilesetId: 'missing-source', tileId: 9, pixelHash: 'base' } });
    store.dispatch({ type: 'remapCells', layerId, cells: [{ x: 1, y: 2 }], tilesetId: slot.assetId, tileId: slot.tileId });
    const input = rgba(7);
    store.dispatch({ type: 'editTilePixels', assetId: slot.assetId, tileId: 0, x: 0, y: 0, width: 1, height: 1, after: input });
    input.fill(0);
    store.commit();
    const final = serializeLevel(store.document);
    const project = serializeProject({ name: 'P', levels: [], tilesets: store.document.tilesets });
    expect(isGeneratedAsset(parseProject(project).tilesets[0]!)).toBe(true);
    expect(serializeProject(parseProject(project))).toBe(project);
    expect(rasters.getTile(slot.assetId, 0)!.data).toEqual(rgba(7));
    rasters.getTile(slot.assetId, 0)!.data.fill(0);
    expect(rasters.getTile(slot.assetId, 0)!.data).toEqual(rgba(7));
    expect(store.undo()).toBe(true);
    expect(serializeLevel(store.document)).toBe(initial);
    expect(store.document.tilesets).toHaveLength(0);
    expect(rasters.assetIds()).toEqual([]);
    expect(store.redo()).toBe(true);
    expect(serializeLevel(store.document)).toBe(final);
    expect(serializeProject({ name: 'P', levels: [], tilesets: store.document.tilesets })).toBe(project);
    expect(rasters.getTile(slot.assetId, 0)!.data).toEqual(rgba(7));
  });

  it('validates bounds and all patches before mutation, canonicalizes transparent RGB, reports dirty rects', () => {
    const { store, rasters } = setup();
    const slot = store.dispatch({ type: 'allocateEditedTile', tileWidth: 2, tileHeight: 1, pixels: new Uint8Array([9,8,7,0, 1,2,3,255]) });
    expect(rasters.getTile(slot.assetId, 0)!.data.slice(0,4)).toEqual(new Uint8Array(4));
    const before = rasters.getTile(slot.assetId, 0)!.data;
    expect(() => store.dispatch({ type: 'editTilePixels', assetId: slot.assetId, tileId: 0, x: 1, y: 0, width: 2, height: 1, after: new Uint8Array(8) })).toThrow();
    expect(rasters.getTile(slot.assetId, 0)!.data).toEqual(before);
    const events: unknown[] = [];
    store.subscribe(e => events.push(e.pixelRects));
    store.dispatch({ type: 'editTilePixels', assetId: slot.assetId, tileId: 0, x: 1, y: 0, width: 1, height: 1, after: rgba(42) });
    expect(events).toContainEqual([{ assetId: slot.assetId, tileId: 0, x: 1, y: 0, width: 1, height: 1 }]);
    store.undo();
    expect(rasters.getTile(slot.assetId, 0)!.data).toEqual(before);
  });

  it('random allocate/edit/remap/undo/redo preserves document and raster snapshots', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 1, maxLength: 40 }), values => {
      const { store, rasters, layerId } = setup();
      store.dispatch({type:'addTileset',tileset:{id:'source',name:'Source',imagePath:'tilesets/source.png',tileWidth:1,tileHeight:1,columns:256,rows:1,margin:0,spacing:0}});
      store.clearHistory();
      const initial = serializeLevel(store.document);
      const snapshots: { level: string; project: string; raster: number[] }[] = [];
      for (const [i, value] of values.entries()) {
        store.beginTransaction();
        const slot = store.dispatch({ type: 'allocateEditedTile', tileWidth: 1, tileHeight: 1, pixels: rgba(value) });
        store.dispatch({type:'addPaletteEntry',tilesetId:'source',tileId:value,undoable:true});
        const index = store.getOrAddPaletteIndex(slot.assetId, slot.tileId);
        store.dispatch({ type: 'paintCells', layerId, cells: [{ x: i % 8, y: (i >> 3) % 8, cell: makeCell(index, FLIP_H) }] });
        store.dispatch({ type: 'remapCells', layerId, cells: [{ x: i % 8, y: (i >> 3) % 8 }], tilesetId: slot.assetId, tileId: slot.tileId });
        store.dispatch({ type: 'editTilePixels', assetId: slot.assetId, tileId: slot.tileId, x: 0, y: 0, width: 1, height: 1, after: rgba(value ^ 255) });
        store.commit();
        snapshots.push({ level: serializeLevel(store.document), project: serializeProject({ name: 'P', levels: [], tilesets: store.document.tilesets }), raster: [...rasters.getAsset(slot.assetId)!.data] });
        store.undo(); store.redo();
        expect(serializeLevel(store.document)).toBe(snapshots[i]!.level);
      }
      for (let i = values.length; i > 0; i--) expect(store.undo()).toBe(true);
      expect(serializeLevel(store.document)).toBe(initial);
      expect(rasters.assetIds()).toEqual([]);
      for (const expected of snapshots) {
        expect(store.redo()).toBe(true);
        expect(serializeLevel(store.document)).toBe(expected.level);
        expect(serializeProject({ name: 'P', levels: [], tilesets: store.document.tilesets })).toBe(expected.project);
        expect([...rasters.getAsset('edited-1x1-1')!.data]).toEqual(expected.raster);
      }
    }), { numRuns: 40 });
  });
});

it('encodes deterministic RGBA PNG with independent zlib decoding', () => {
  const data = new Uint8Array([1,2,3,255, 9,8,7,0]);
  const png = encodeRgbaPng(2,1,data);
  expect(encodeRgbaPng(2,1,data)).toEqual(png);
  expect([...png.slice(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  const chunks: Uint8Array[] = [];
  for (let p = 8; p < png.length;) {
    const size = new DataView(png.buffer, png.byteOffset + p, 4).getUint32(0);
    const type = String.fromCharCode(...png.slice(p+4,p+8));
    if (type === 'IDAT') chunks.push(png.slice(p+8,p+8+size));
    p += size + 12;
  }
  expect([...inflateSync(chunks[0]!)]).toEqual([0,1,2,3,255,0,0,0,0]);
  expect(rasterContentHash(2,1,data)).toBe(rasterContentHash(2,1,new Uint8Array([1,2,3,255,0,0,0,0])));
  expect(rasterContentHash(1,2,data)).not.toBe(rasterContentHash(2,1,data));
});

it('PNG block boundaries, CRCs and SHA-256 match independent oracles', () => {
  for (const [width,height] of [[1,1],[127,129]] as const) {
    const pixels = new Uint8Array(width*height*4);
    for (let p=0; p<pixels.length; p+=4) { pixels[p]=(p>>>2)&255; pixels[p+1]=37; pixels[p+2]=255; pixels[p+3]=128; }
    const png = encodeRgbaPng(width,height,pixels);
    expect(decodePng(png).data.every((v,i)=>v===pixels[i])).toBe(true);
    const geometry = new Uint8Array(8); const view = new DataView(geometry.buffer); view.setUint32(0,width); view.setUint32(4,height);
    expect(rasterContentHash(width,height,pixels)).toBe(createHash('sha256').update(new Uint8Array([...geometry,...pixels])).digest('hex'));
    // Independent CRC via polynomial long division (MSB-first representation).
    const reverse = (x: number) => { let r=0; for(let n=0;n<32;n++){ r=(r<<1)|(x&1); x>>>=1; } return r>>>0; };
    const crc = (bytes: Uint8Array) => { let r=0xffffffff; for(const value of bytes){ r^=reverse(value)>>>0; for(let n=0;n<8;n++) r=((r<<1)^((r>>>31)?0x04c11db7:0))>>>0; } return (reverse(r)^0xffffffff)>>>0; };
    const v = new DataView(png.buffer);
    for(let p=8;p<png.length;){ const len=v.getUint32(p); expect(v.getUint32(p+8+len)).toBe(crc(png.subarray(p+4,p+8+len))); p+=len+12; }
  }
});

it('prevalidates a patch batch and rolls back allocation on cancellation', () => {
  const { store, rasters, layerId }=setup();
  const initial=serializeLevel(store.document);
  store.beginTransaction();
  const slot=store.dispatch({type:'allocateEditedTile',tileWidth:2,tileHeight:1,pixels:new Uint8Array(8)});
  store.dispatch({type:'remapCells',layerId,cells:[{x:0,y:0}],tilesetId:slot.assetId,tileId:0});
  const patch={assetId:slot.assetId,tileId:0,x:0,y:0,width:1,height:1,before:new Uint8Array(4),after:rgba(3)};
  const revision=rasters.revision;
  expect(()=>store.dispatch({type:'patchPixels',patches:[patch,{...patch,x:2}]})).toThrow();
  expect(rasters.revision).toBe(revision);
  expect(rasters.getTile(slot.assetId,0)!.data).toEqual(new Uint8Array(8));
  store.dispatch({type:'patchPixels',patches:[patch,{...patch,x:1,after:rgba(8)}]});
  const returned=store.peekUndo();
  expect(returned).toBeUndefined();
  store.rollback();
  expect(serializeLevel(store.document)).toBe(initial);
  expect(rasters.assetIds()).toEqual([]);
  expect(store.canUndo).toBe(false);
});

it('history patches and decoded input never alias; load rejects stale metadata', () => {
  const { store,rasters }=setup();
  const slot=store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:rgba(5)});
  const input=rasters.getAsset(slot.assetId)!;
  const ts=store.document.tilesets[0]!;
  const loaded=new MapStore(createDocument({width:2,height:2,tilesets:[ts]}));
  loaded.dispatch({type:'loadRasterAsset',asset:{assetId:ts.id,tileWidth:1,tileHeight:1,columns:16,rows:1,data:input.data}});
  input.data.fill(0);
  expect(loaded.rasterAssets.getTile(ts.id,0)!.data).toEqual(rgba(5));
  expect(()=>loaded.dispatch({type:'loadRasterAsset',asset:{assetId:ts.id,tileWidth:1,tileHeight:1,columns:16,rows:1,data:input.data}})).toThrow(/hash/);
  expect(loaded.rasterAssets.getTile(ts.id,0)!.data).toEqual(rgba(5));
  const patches=store.dispatch({type:'editTilePixels',assetId:ts.id,tileId:0,x:0,y:0,width:1,height:1,after:rgba(9)});
  patches[0]!.before.fill(0); patches[0]!.after.fill(0);
  for(const change of store.peekUndo()!.changes) if(change.kind==='pixels') change.patches[0]!.before.fill(0);
  store.undo(); expect(rasters.getTile(ts.id,0)!.data).toEqual(rgba(5));
  store.redo(); expect(rasters.getTile(ts.id,0)!.data).toEqual(rgba(9));
});

it('random interleaved editing, allocation, remapping, cancellation, undo and redo matches snapshots', () => {
  fc.assert(fc.property(fc.array(fc.tuple(fc.integer({min:0,max:6}),fc.integer({min:0,max:255})),{minLength:1,maxLength:60}), actions=>{
    const {store,rasters,layerId}=setup();
    const snapshot=()=>JSON.stringify({level:serializeLevel(store.document),tilesets:store.document.tilesets,rasters:rasters.assetIds().map(id=>[id,[...rasters.getAsset(id)!.data]])});
    let current=snapshot();const undo:string[]=[],redo:string[]=[];
    for(const [action,value] of actions){
      if(action===4){if(undo.length){redo.push(current);current=undo.pop()!;expect(store.undo()).toBe(true);} }
      else if(action===5){if(redo.length){undo.push(current);current=redo.pop()!;expect(store.redo()).toBe(true);} }
      else {
        const before=current;
        store.beginTransaction();
        const ts=store.document.tilesets[0];
        const slot=action===0||!ts ? store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:rgba(value)}) : {assetId:ts.id,tileId:value%ts.edited!.nextTileId};
        store.dispatch({type:'editTilePixels',assetId:slot.assetId,tileId:slot.tileId,x:0,y:0,width:1,height:1,after:rgba(value)});
        store.dispatch({type:'remapCells',layerId,cells:[{x:value%8,y:(value>>3)%8}],tilesetId:slot.assetId,tileId:slot.tileId});
        if(action===6) store.rollback();
        else {store.commit();current=snapshot();if(current!==before){undo.push(before);redo.length=0;}}
      }
      expect(snapshot()).toBe(current);
    }
  }),{numRuns:50});
});

it('syncs edited metadata across stores sharing a raster registry without replaying raster writes', () => {
  const {store,rasters}=setup();
  const slot=store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:rgba(5)});
  const other=new MapStore(createDocument({width:2,height:2,tilesets:store.document.tilesets}),{rasterAssets:rasters});
  const before=other.document.tilesets[0]!;
  store.dispatch({type:'editTilePixels',assetId:slot.assetId,tileId:0,x:0,y:0,width:1,height:1,after:rgba(9)});
  other.dispatch({type:'setEditedTileset',tileset:store.document.tilesets[0]!});
  expect(other.document.tilesets[0]).toEqual(store.document.tilesets[0]);
  const revision=rasters.revision;
  other.undo();expect(other.document.tilesets[0]).toEqual(before);
  expect(rasters.revision).toBe(revision);
  other.redo();expect(other.document.tilesets[0]).toEqual(store.document.tilesets[0]);
  expect(()=>other.dispatch({type:'setEditedTileset',tileset:{...before,columns:8}})).toThrow();
});

it('retains later nonundoable palette additions when undoing an allocation', () => {
  const {store}=setup();
  store.dispatch({type:'addTileset',tileset:{id:'source',name:'Source',imagePath:'tilesets/source.png',tileWidth:1,tileHeight:1,columns:1,rows:1,margin:0,spacing:0}});
  store.clearHistory();
  const slot=store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:rgba(1)});
  const sourceIndex=store.getOrAddPaletteIndex('source',0);
  store.undo();
  expect(store.document.palette.get(sourceIndex)).toEqual({tilesetId:'source',tileId:0});
  store.redo();
  expect(store.document.palette.get(sourceIndex)).toEqual({tilesetId:'source',tileId:0});
  expect(store.document.palette.get(slot.paletteIndex)).toEqual({tilesetId:slot.assetId,tileId:0});
});

it('coalesces overlapping tile writes within one gesture and replays their first/last bytes', () => {
  const {store,rasters}=setup();
  const slot=store.dispatch({type:'allocateEditedTile',tileWidth:2,tileHeight:1,pixels:new Uint8Array(8)});
  store.beginTransaction();
  for(let i=0;i<20;i++) store.dispatch({type:'editTilePixels',assetId:slot.assetId,tileId:0,x:i%2,y:0,width:1,height:1,after:rgba(i)});
  store.commit();
  const history=store.peekUndo()!.changes.filter(c=>c.kind==='pixels');
  expect(history).toHaveLength(1);expect(history[0]!.patches).toHaveLength(1);
  const final=rasters.getTile(slot.assetId,0)!.data;
  store.undo();expect(rasters.getTile(slot.assetId,0)!.data).toEqual(new Uint8Array(8));
  store.redo();expect(rasters.getTile(slot.assetId,0)!.data).toEqual(final);
});

it('tile revisions only invalidate changed tiles and never decrease on replay', () => {
  const {store,rasters}=setup();
  const a=store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:rgba(1)});
  store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:rgba(2)});
  const before=rasters.getTile(a.assetId,0)!.revision;
  const other=rasters.getTile(a.assetId,1)!.revision;
  store.dispatch({type:'editTilePixels',assetId:a.assetId,tileId:0,x:0,y:0,width:1,height:1,after:rgba(3)});
  expect(rasters.getTile(a.assetId,0)!.revision).toBeGreaterThan(before);
  expect(rasters.getTile(a.assetId,1)!.revision).toBe(other);
  const edited=rasters.getTile(a.assetId,0)!.revision;
  store.undo();expect(rasters.getTile(a.assetId,0)!.revision).toBeGreaterThan(edited);
});

it('refuses stale participant allocation metadata instead of overwriting another live shared slot', () => {
  const {store,rasters}=setup();
  const slot=store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:rgba(1)});
  const stale=new MapStore(createDocument({width:2,height:2,tilesets:store.document.tilesets}),{rasterAssets:rasters});
  store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:rgba(2)});
  const before=rasters.getAsset(slot.assetId)!.data;
  expect(()=>stale.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:rgba(3)})).toThrow(/loaded/);
  expect(()=>stale.dispatch({type:'editTilePixels',assetId:slot.assetId,tileId:0,x:0,y:0,width:1,height:1,after:rgba(3)})).toThrow(/synchronized/);
  expect(rasters.getAsset(slot.assetId)!.data).toEqual(before);
});

it('starts the next deterministic atlas when a native-size page is full', () => {
  const {store}=setup();
  const data=new Uint8Array(16*256*4),contentHash=rasterContentHash(16,256,data);
  store.dispatch({type:'addTileset',tileset:{id:'edited-1x1-1',name:'Full',imagePath:`tilesets/edited-1x1-1-${contentHash}.png`,tileWidth:1,tileHeight:1,columns:16,rows:256,margin:0,spacing:0,edited:{kind:'pixel',layoutVersion:1,nextTileId:4096,contentHash,origins:[]}}});
  store.clearHistory();
  store.dispatch({type:'loadRasterAsset',asset:{assetId:'edited-1x1-1',tileWidth:1,tileHeight:1,columns:16,rows:256,data}});
  const slot=store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:rgba(5)});
  expect(slot.assetId).toBe('edited-1x1-2');expect(slot.tileId).toBe(0);
  store.undo();store.redo();expect(store.document.tilesets[1]!.id).toBe(slot.assetId);
});

it('rejects nontransparent data outside allocated slots without losing authoritative PNG bytes', () => {
  const {store}=setup();
  const data=new Uint8Array(16*4);data.set(rgba(1),4);
  const contentHash=rasterContentHash(16,1,data);
  store.dispatch({type:'addTileset',tileset:{id:'edited',name:'Edited',imagePath:'tilesets/edited.png',tileWidth:1,tileHeight:1,columns:16,rows:1,margin:0,spacing:0,edited:{kind:'pixel',layoutVersion:1,nextTileId:1,contentHash,origins:[]}}});
  store.clearHistory();
  expect(()=>store.dispatch({type:'loadRasterAsset',asset:{assetId:'edited',tileWidth:1,tileHeight:1,columns:16,rows:1,data}})).toThrow(/unallocated/);
  expect(store.rasterAssets.assetIds()).toEqual([]);
});

it('keeps source pixels and captured origins independent of removal/regrid and later caller writes', () => {
  const {store,rasters}=setup();
  store.dispatch({type:'addTileset',tileset:{id:'source',name:'Source',imagePath:'tilesets/source.png',tileWidth:1,tileHeight:1,columns:1,rows:1,margin:0,spacing:0}});
  store.clearHistory();
  const original=rgba(7);
  store.dispatch({type:'loadRasterAsset',asset:{assetId:'source',tileWidth:1,tileHeight:1,columns:1,rows:1,data:original}});
  const slot=store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:original,source:{tilesetId:'source',tileId:0,pixelHash:rasterContentHash(1,1,original)}});
  original.fill(0);
  store.dispatch({type:'editTilePixels',assetId:slot.assetId,tileId:0,x:0,y:0,width:1,height:1,after:rgba(9)});
  expect(rasters.getTile('source',0)!.data).toEqual(rgba(7));
  const origins=store.document.getTileset(slot.assetId)!.edited!.origins;
  store.dispatch({type:'removeTileset',tilesetId:'source'});
  expect(store.document.getTileset(slot.assetId)!.edited!.origins).toEqual(origins);
  expect(rasters.getTile(slot.assetId,0)!.data).toEqual(rgba(9));
  expect(()=>store.dispatch({type:'updateTilesetGrid',tilesetId:slot.assetId,tileWidth:2,tileHeight:2,margin:0,spacing:0})).toThrow(/cannot change/);
});

it('clears a conflicting edited redo branch when a nonundoable palette addition reuses its freed slot', () => {
  const {store}=setup();
  store.dispatch({type:'addTileset',tileset:{id:'source',name:'Source',imagePath:'tilesets/source.png',tileWidth:1,tileHeight:1,columns:1,rows:1,margin:0,spacing:0}});
  store.clearHistory();
  store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:rgba(1)});
  store.undo();
  const historyEvents:boolean[]=[];
  store.subscribe(event=>historyEvents.push(event.historyChanged));
  const sourceIndex=store.getOrAddPaletteIndex('source',0);
  expect(historyEvents.at(-1)).toBe(true);
  expect(store.canRedo).toBe(false);
  expect(store.redo()).toBe(false);
  expect(store.document.palette.get(sourceIndex)).toEqual({tilesetId:'source',tileId:0});
});

it('clears allocation-dependent redo when nonundoable growth appends beyond retained slots', () => {
  const {store}=setup();
  store.dispatch({type:'addTileset',tileset:{id:'source',name:'Source',imagePath:'tilesets/source.png',tileWidth:1,tileHeight:1,columns:2,rows:1,margin:0,spacing:0}});
  store.clearHistory();
  const slot=store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:rgba(1)});
  store.getOrAddPaletteIndex('source',0);
  store.undo();
  const sourceIndex=store.getOrAddPaletteIndex('source',1);
  expect(store.canRedo).toBe(false);
  expect(store.redo()).toBe(false);
  expect(store.document.palette.get(sourceIndex)).toEqual({tilesetId:'source',tileId:1});
  expect(store.document.palette.get(slot.paletteIndex)).toEqual({tilesetId:slot.assetId,tileId:0});
});

it('keeps a nonundoable source entry safe when a replacement edited allocation is cancelled', () => {
  const {store}=setup();
  store.dispatch({type:'addTileset',tileset:{id:'source',name:'Source',imagePath:'tilesets/source.png',tileWidth:1,tileHeight:1,columns:1,rows:1,margin:0,spacing:0}});
  store.clearHistory();
  store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:rgba(1)});
  store.undo();
  store.beginTransaction();
  store.dispatch({type:'allocateEditedTile',tileWidth:2,tileHeight:1,pixels:new Uint8Array(8)});
  const sourceIndex=store.getOrAddPaletteIndex('source',0);
  store.rollback();
  expect(store.canRedo).toBe(false);
  expect(store.document.palette.get(sourceIndex)).toEqual({tilesetId:'source',tileId:0});
});

it('journals explicit source palette additions with cells, pixels and edited metadata in one step', () => {
  const {store,rasters,layerId}=setup();
  store.dispatch({type:'addTileset',tileset:{id:'source',name:'Source',imagePath:'tilesets/source.png',tileWidth:1,tileHeight:1,columns:1,rows:1,margin:0,spacing:0}});
  store.clearHistory();
  const before=serializeLevel(store.document);
  store.beginTransaction();
  const slot=store.dispatch({type:'allocateEditedTile',tileWidth:1,tileHeight:1,pixels:rgba(1)});
  const sourceIndex=store.dispatch({type:'addPaletteEntry',tilesetId:'source',tileId:0,undoable:true});
  store.dispatch({type:'paintCells',layerId,cells:[{x:0,y:0,cell:makeCell(sourceIndex,FLIP_H)}]});
  store.dispatch({type:'remapCells',layerId,cells:[{x:0,y:0}],tilesetId:slot.assetId,tileId:0});
  store.dispatch({type:'editTilePixels',assetId:slot.assetId,tileId:0,x:0,y:0,width:1,height:1,after:rgba(3)});
  store.commit();
  expect(store.undoDepth).toBe(1);
  expect(store.document.getLayer(layerId)!.getCell(0,0)).toBe(makeCell(slot.paletteIndex,FLIP_H));
  const after=serializeLevel(store.document);
  store.undo();expect(serializeLevel(store.document)).toBe(before);expect(rasters.assetIds()).toEqual([]);
  store.redo();expect(serializeLevel(store.document)).toBe(after);expect(rasters.getTile(slot.assetId,0)!.data).toEqual(rgba(3));
});

it('canonicalization owns bytes even when the input slice method shares memory', () => {
  const source=new Uint8Array([9,8,7,0,1,2,3,255]);
  // Buffer.slice and some typed-array subclasses return borrowed views.
  source.slice=()=>source.subarray(0);
  const actual=canonicalRgba(2,1,source);
  expect([...source]).toEqual([9,8,7,0,1,2,3,255]);
  source.fill(0);
  expect([...actual]).toEqual([0,0,0,0,1,2,3,255]);
});

it('cached raster hashes own canonical bytes and match SHA-256 after mutation and eviction', () => {
  const oracle = (width: number, height: number, pixels: Uint8Array) => {
    const geometry = new Uint8Array(8), view = new DataView(geometry.buffer); view.setUint32(0, width); view.setUint32(4, height);
    return createHash('sha256').update(new Uint8Array([...geometry, ...canonicalRgba(width, height, pixels)])).digest('hex');
  };
  const pixels = new Uint8Array(32 * 32 * 4).fill(255), first = rasterContentHash(32, 32, pixels);
  expect(first).toBe(oracle(32, 32, pixels));
  pixels[0] = 9; expect(rasterContentHash(32, 32, pixels)).toBe(oracle(32, 32, pixels));
  pixels[0] = 255; expect(rasterContentHash(32, 32, pixels)).toBe(first);
  pixels.set([99, 88, 77, 0]); const zero = rasterContentHash(32, 32, pixels); pixels.set([1, 2, 3, 0]); expect(rasterContentHash(32, 32, pixels)).toBe(zero);
  for (let n = 1; n < 20; n++) { const data = new Uint8Array(16 * n * 4).fill(n); expect(rasterContentHash(16, n, data)).toBe(oracle(16, n, data)); }
  expect(rasterContentHash(32, 32, pixels)).toBe(oracle(32, 32, pixels));
});

it('uses the caller display name only for a new edited atlas and replays it deterministically', () => {
  fc.assert(fc.property(fc.constantFrom('Edited', 'Düzenlenen', 'My artwork'), name => {
    const { store } = setup();
    const allocate = (label: string) => store.dispatch({ type: 'allocateEditedTile', name: label, tileWidth: 1, tileHeight: 1, pixels: rgba(4) });
    const first = allocate(name);
    expect(store.document.getTileset(first.assetId)!.name).toBe(name);
    const firstProject = serializeProject({ name: 'P', levels: [], tilesets: store.document.tilesets });
    store.undo();store.redo();
    expect(serializeProject({ name: 'P', levels: [], tilesets: store.document.tilesets })).toBe(firstProject);
    store.dispatch({ type: 'setTilesetMeta', tilesetId: first.assetId, name: 'User name' });
    expect(allocate('Another locale').assetId).toBe(first.assetId);
    expect(store.document.getTileset(first.assetId)!.name).toBe('User name');
    const final = serializeProject({ name: 'P', levels: [], tilesets: store.document.tilesets });
    while (store.canUndo) store.undo();
    expect(store.document.tilesets).toHaveLength(0);
    while (store.canRedo) store.redo();
    expect(serializeProject({ name: 'P', levels: [], tilesets: store.document.tilesets })).toBe(final);
  }), { numRuns: 3 });
});
