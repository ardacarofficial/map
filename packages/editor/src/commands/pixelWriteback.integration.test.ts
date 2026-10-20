import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rasterContentHash } from '@smap/core';
import { browserPlatform, setPlatform } from '../platform';
import { newProject, closeProject, withProjectWriteGate } from '../io/session';
import { MemoryFileSystem } from '../io/memoryFs';
import { encodeSourcePng, decodeSourcePng } from '../io/sourcePng';
import { reloadTilesetImage } from '../platform/fileChanges';
import { getTilesetImage, onTilesetImage, setTilesetImage } from '../state/tilesetImages';
import { capturedPixelHash } from '../state/pixelProvenance';
import { useEditorStore } from '../state/editorStore';
import { choosePngBackup, closePngWriteback, confirmPngWriteback, openPngWriteback, selectPngSource, usePngWriteback } from './pixelWriteback';
const source={id:'source',name:'Source',imagePath:'tilesets/source.png',tileWidth:2,tileHeight:2,columns:1,rows:1,margin:0,spacing:0};
beforeEach(()=>{
  setPlatform({...browserPlatform,watchProject:()=>{},recents:{...browserPlatform.recents,add:async()=>{},list:async()=>[]}});
  vi.stubGlobal('createImageBitmap',async(bytes:Blob)=>{const image=decodeSourcePng(new Uint8Array(await bytes.arrayBuffer()));return {width:image.width,height:image.height,close(){}} as ImageBitmap;});
});
afterEach(()=>{usePngWriteback.setState({busy:false,writing:false});closePngWriteback();closeProject();setPlatform(browserPlatform);vi.unstubAllGlobals();vi.restoreAllMocks();});
async function fixture() {
  const fs=new MemoryFileSystem();await newProject({name:'World',width:4,height:4,tileSize:2,folder:{fs,label:'World',ref:'world'}});
  const store=useEditorStore.getState().project!.store;
  store.dispatch({type:'addTileset',tileset:source});
  const data=new Uint8Array(16).fill(255),original=encodeSourcePng({width:2,height:2,data});await fs.writeBytes(source.imagePath,original);
  setTilesetImage({tilesetId:source.id,bytes:original,bitmap:{width:2,height:2,close(){}} as ImageBitmap});
  const pixels=data.slice();pixels.set([12,34,56,7]);
  const slot=store.dispatch({type:'allocateEditedTile',tileWidth:2,tileHeight:2,pixels,source:{tilesetId:source.id,tileId:0,pixelHash:capturedPixelHash(rasterContentHash(2,2,data),source)}});
  store.dispatch({type:'remapCells',layerId:store.document.layers[0]!.id,cells:[{x:0,y:0}],tilesetId:slot.assetId,tileId:slot.tileId});
  return {fs,store,original,pixels,slot};
}
describe('confirmed PNG commands and image pipeline',()=>{
  it('publishes source once, ignores equal-byte watcher echoes, keeps clones/undo, and restores through the same path',async()=>{
    const {fs,store,original,pixels,slot}=await fixture();const imageEvents:string[]=[];const off=onTilesetImage(id=>imageEvents.push(id));
    try {
      const depth=store.undoDepth;await openPngWriteback();const backup=usePngWriteback.getState().draft!.backupPath;
      expect(await fs.readBytes(source.imagePath)).toEqual(original);
      await confirmPngWriteback();expect(usePngWriteback.getState().draft).toBeNull();expect(store.undoDepth).toBe(depth);
      expect(store.rasterAssets.getTile(slot.assetId,slot.tileId)!.data).toEqual(pixels);
      expect(await fs.readBytes(backup)).toEqual(original);expect(imageEvents).toEqual([source.id]);
      const current=await fs.readBytes(source.imagePath);expect(getTilesetImage(source.id)!.bytes).toEqual(current);
      await reloadTilesetImage(source.imagePath);await reloadTilesetImage(source.imagePath);expect(imageEvents).toEqual([source.id]);
      await openPngWriteback(undefined,'restore');await choosePngBackup(backup);const restoreBackup=usePngWriteback.getState().draft!.backupPath;
      await confirmPngWriteback();expect(await fs.readBytes(source.imagePath)).toEqual(original);expect(await fs.readBytes(restoreBackup)).toEqual(current);expect(imageEvents).toEqual([source.id,source.id]);expect(store.undoDepth).toBe(depth);
    }finally{off();}
  });
  it('shares the project save gate and rejects a source changed while confirmation waits in that queue',async()=>{
    const {fs,original}=await fixture();await openPngWriteback();
    let release!:()=>void;const gate=withProjectWriteGate(()=>new Promise<void>(resolve=>{release=resolve;}));
    await Promise.resolve();const write=confirmPngWriteback();const external=original.slice();external[0]=12;await fs.writeBytes(source.imagePath,external);release();await gate;await write;
    expect(usePngWriteback.getState().changed).toBe(true);expect(await fs.readBytes(source.imagePath)).toEqual(external);expect(await fs.list('backups/png')).toEqual([]);
  });
  it('requires a new review after external change; reload never writes and a fresh confirmation backs up current bytes',async()=>{
    const {fs}=await fixture();const external=encodeSourcePng({width:2,height:2,data:new Uint8Array(16).fill(99)});await fs.writeBytes(source.imagePath,external);
    await openPngWriteback();expect(usePngWriteback.getState().changed).toBe(true);await confirmPngWriteback();expect(await fs.readBytes(source.imagePath)).toEqual(external);
    await selectPngSource(source.id,true);expect(usePngWriteback.getState().changed).toBe(false);expect(await fs.list('backups/png')).toEqual([]);const backup=usePngWriteback.getState().draft!.backupPath;
    await confirmPngWriteback();expect(await fs.readBytes(backup)).toEqual(external);
  });
  it('refuses stale map edits and changed backup bytes under an old confirmation',async()=>{
    const {fs,store}=await fixture();await openPngWriteback();store.dispatch({type:'setLayerProps',layerId:store.document.layers[0]!.id,props:{locked:true}});await confirmPngWriteback();expect(usePngWriteback.getState().changed).toBe(true);expect(await fs.list('backups/png')).toEqual([]);
    await openPngWriteback();const backup=usePngWriteback.getState().draft!.backupPath;await confirmPngWriteback();const current=await fs.readBytes(source.imagePath);
    await openPngWriteback(undefined,'restore');await choosePngBackup(backup);await fs.writeBytes(backup,current);await confirmPngWriteback();expect(usePngWriteback.getState().changed).toBe(true);expect(await fs.readBytes(source.imagePath)).toEqual(current);
  });
});
