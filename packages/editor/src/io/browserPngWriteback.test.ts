import { describe, expect, it } from 'vitest';
import { DirectoryHandleFileSystem } from './browserFs';
import { applyPngPatch, preparePngPatch } from './pngWriteback';
import { encodeSourcePng } from './sourcePng';
import { rasterContentHash } from '@smap/core';

/** FSA contract double: createWritable stages, close atomically commits, abort discards. */
function directory(files:Map<string,Uint8Array>, onStage:(path:string)=>void=()=>{}) {
  const folders=new Set(['','tilesets']);let aborted=0;
  const folder=(path:string):FileSystemDirectoryHandle=>({name:'opfs',kind:'directory',
    async getDirectoryHandle(name:string,options?:{create?:boolean}) { const key=path?`${path}/${name}`:name;if(options?.create)folders.add(key);if(!folders.has(key))throw new DOMException('missing','NotFoundError');return folder(key); },
    async getFileHandle(name:string,options?:{create?:boolean}) { const key=path?`${path}/${name}`:name;if(!files.has(key)){if(!options?.create)throw new DOMException('missing','NotFoundError');files.set(key,new Uint8Array());}return {
      async getFile(){const bytes=files.get(key)!.slice();return{arrayBuffer:async()=>bytes.buffer};},
      async createWritable(){let staged=new Uint8Array();return{
        async write(blob:Blob){staged=new Uint8Array(await blob.arrayBuffer());onStage(key);},
        async close(){files.set(key,staged);},
        async abort(){aborted++;},
      };},
    };},
  }) as unknown as FileSystemDirectoryHandle;
  return {fs:new DirectoryHandleFileSystem(folder('')),aborts:()=>aborted};
}
const source={id:'s',name:'Source',imagePath:'tilesets/a.png',tileWidth:1,tileHeight:1,columns:1,rows:1,margin:0,spacing:0};
async function fixture(onStage?:(path:string)=>void) {
  const data=Uint8Array.of(1,2,3,255),original=encodeSourcePng({width:1,height:1,data}),files=new Map([[source.imagePath,original]]);
  const adapter=directory(files,onStage),plan=await preparePngPatch(adapter.fs,source,[{tileId:0,baseHash:rasterContentHash(1,1,data),pixels:{width:1,height:1,data:Uint8Array.of(4,5,6,255)}}]);
  return {...adapter,files,original,plan};
}
describe('browser PNG atomic adapter',()=>{
  it('commits a verified backup before replacing through the FSA swap stream',async()=>{
    const {fs,files,original,plan,aborts}=await fixture();await applyPngPatch(fs,plan);
    expect(files.get(plan.backupPath)).toEqual(original);expect(files.get(source.imagePath)).toEqual(plan.replacement);expect(aborts()).toBe(0);
  });
  it('aborts a staged replacement if disk changes while writing the temporary stream',async()=>{
    const {fs,files,original,plan,aborts}=await fixture(path=>{if(path===source.imagePath)files.set(path,Uint8Array.of(99));});
    await expect(applyPngPatch(fs,plan)).rejects.toThrow('changed');expect(files.get(plan.backupPath)).toEqual(original);expect(files.get(source.imagePath)).toEqual(Uint8Array.of(99));expect(aborts()).toBe(1);
  });
  it('aborts denied backup streams and leaves the original source intact',async()=>{
    const {fs,files,original,plan,aborts}=await fixture(path=>{if(path.startsWith('backups/'))throw new DOMException('denied','NotAllowedError');});
    await expect(applyPngPatch(fs,plan)).rejects.toThrow('denied');expect(files.get(source.imagePath)).toEqual(original);expect(aborts()).toBe(1);
  });
});
