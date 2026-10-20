import { expect, it, vi } from 'vitest';
import { createDocument, MapStore, RasterAssets } from '@smap/core';
import { RasterSheet } from './rasterSheet';

it('updates retained surfaces and alpha from dirty tiles across commit, undo and redo', () => {
  const puts = vi.fn(), create = () => ({ width: 300, height: 150, dataset: {}, getContext: () => ({ putImageData: puts, clearRect() {}, drawImage() {} }) }) as unknown as HTMLCanvasElement;
  vi.stubGlobal('document', { createElement: create });
  vi.stubGlobal('ImageData', class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} });
  const store = new MapStore(createDocument({ width: 1, height: 1 }));
  let id = '';
  for (let i=0;i<16;i++) id = store.dispatch({type:'allocateEditedTile',tileWidth:32,tileHeight:32,pixels:new Uint8Array(4096).fill(255)}).assetId;
  store.clearHistory();
  const sheet = new RasterSheet(id), a = create(), b = create();
  sheet.update(store.rasterAssets.fork(), Array.from({length:16},(_,tileId)=>({assetId:id,tileId,x:0,y:0,width:32,height:32})));
  sheet.draw(a); sheet.draw(b); sheet.bitmap(); expect(sheet.emptyTiles().size).toBe(0);
  const read = vi.spyOn(RasterAssets.prototype,'getTile'), whole = vi.spyOn(RasterAssets.prototype,'getAsset'); puts.mockClear();
  try {
    const rect = {assetId:id,tileId:5,x:0,y:0,width:32,height:32};
    store.dispatch({type:'editTilePixels',...rect,after:new Uint8Array(4096)});
    for(const move of [null,'undo','redo'] as const){
      if(move)store[move]();
      read.mockClear(); puts.mockClear();
      sheet.update(store.rasterAssets.fork(),[rect]); sheet.draw(a); sheet.draw(b); sheet.bitmap();
      expect(sheet.emptyTiles().has(5)).toBe(move!=='undo');
      expect(read).toHaveBeenCalledTimes(4); expect(read.mock.calls.every(([,tile])=>tile===5)).toBe(true);
      expect(puts).toHaveBeenCalledTimes(3); expect(whole).not.toHaveBeenCalled();
    }
    // Crossing an atlas row and replaying it must not reread old tile pages.
    store.dispatch({type:'allocateEditedTile',tileWidth:32,tileHeight:32,pixels:new Uint8Array(4096).fill(255)});
    for(const move of [null,'undo','redo'] as const){
      if(move)store[move](); read.mockClear();
      sheet.update(store.rasterAssets.fork(),[{assetId:id,tileId:16,x:0,y:0,width:32,height:32}]);
      sheet.draw(a); sheet.draw(b); sheet.bitmap(); sheet.emptyTiles();
      expect(read.mock.calls.every(([,tile])=>tile===16)).toBe(true); expect(whole).not.toHaveBeenCalled();
    }
  } finally { read.mockRestore(); whole.mockRestore(); vi.unstubAllGlobals(); }
});
