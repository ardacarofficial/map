import { expect, it, vi } from "vitest";
import { createAgentApi, createMemoryHost, memoryCall, type AnyToolSuccess } from "@smap/agent";
import { MemoryFileSystem } from "../io/memoryFs";
import { createTagsPort, serializeTagsSidecar } from "./tagsIo";

it("measures a 50000 tile atlas with ten sparse tags through the editor adapter and MCP", async () => {
  const tileset={id:"atlas",name:"Sparse",imagePath:"tilesets/sparse.png",columns:250,rows:200,tileWidth:1,tileHeight:1,margin:0,spacing:0};
  const host=createMemoryHost({tilesets:[tileset]}), fs=new MemoryFileSystem();
  const fingerprint="a".repeat(64), hashes=vi.fn(async()=>fingerprint);
  host.images.tileFingerprint=hashes;
  const id=host.session().worldSessionId!;
  const tagged=Array.from({length:10},(_,i)=>({tilesetId:"atlas",tileId:i*4999,fingerprint,tags:["merdiven"],note:""}));
  await fs.writeText("ai-tags.json",serializeTagsSidecar({format:"smap-ai-tags",tagFormatVersion:1,tiles:tagged,stamps:[]}));
  const tags=createTagsPort({world:host.world,images:host.images,folder:()=>fs,worldId:()=>id});
  host.tags=tags;await tags.reload();
  const api=createAgentApi(host),runs=[];
  for (const temperature of ["cold","warm"]) {
    const start=performance.now(),before=hashes.mock.calls.length;
    let cursor:string|undefined,calls=0,bytes=0,items=0;
    do {
      const result=await api.executeTool(memoryCall("get_tags",{context:{worldSessionId:id},query:"stairs",...(cursor?{cursor}:{})}));
      expect(result.structuredContent.ok).toBe(true);if(!result.structuredContent.ok)throw Error(result.structuredContent.message);
      const data=(result.structuredContent as AnyToolSuccess).data as {items:unknown[];nextCursor:string|null};
      cursor=data.nextCursor??undefined;items+=data.items.length;calls++;bytes+=JSON.stringify(result).length;
    } while(cursor);
    expect(items).toBe(10);
    expect(hashes.mock.calls.length-before).toBe(10);
    expect(calls).toBe(1);
    runs.push({temperature,hashes:hashes.mock.calls.length-before,calls,wireBytes:bytes,items,milliseconds:performance.now()-start});
  }
  console.log("SPARSE_BENCHMARK",JSON.stringify({tiles:50000,tags:10,runs}));
  tags.dispose();
}, 30000);

it("measures real pixel fingerprint caching on the same sparse 50000 tile query",async()=>{
  const core=await import("@smap/core"),{createImagePort}=await import("./images"),{setTilesetImage,clearTilesetImages}=await import("../state/tilesetImages");
  const tileset={id:"atlas",name:"Sparse",imagePath:"tilesets/sparse.png",columns:250,rows:200,tileWidth:1,tileHeight:1,margin:0,spacing:0};
  const host=createMemoryHost({tilesets:[tileset]}),fs=new MemoryFileSystem(),context={worldSessionId:host.session().worldSessionId!};
  const rgba=new Uint8Array(250*200*4);for(let i=0;i<50000;i++)rgba.set([i%251,Math.floor(i/251)%251,40,255],i*4);
  const png=core.encodeRgbaPng(250,200,rgba);
  const install=()=>setTilesetImage({tilesetId:"atlas",bytes:png,bitmap:{width:250,height:200,close:vi.fn()} as unknown as ImageBitmap});
  install();const preparation=createImagePort(host.world,()=>0),call=memoryCall("get_tags",{});
  const records=await Promise.all(Array.from({length:10},async(_,i)=>({tilesetId:"atlas",tileId:i*4999,fingerprint:await preparation.tileFingerprint("atlas",i*4999,call.signal),tags:["merdiven"],note:""})));
  await fs.writeText("ai-tags.json",serializeTagsSidecar({format:"smap-ai-tags",tagFormatVersion:1,tiles:records,stamps:[]}));
  install();host.images=createImagePort(host.world,()=>0);
  const tags=createTagsPort({world:host.world,images:host.images,folder:()=>fs,worldId:()=>context.worldSessionId});host.tags=tags;await tags.reload();
  const api=createAgentApi(host),hash=vi.spyOn(core,"rasterContentHash"),runs=[];
  try {
    for(const temperature of ["cold","warm"]){
      const before=hash.mock.calls.length,start=performance.now();
      const result=await api.executeTool(memoryCall("get_tags",{context,query:"stairs"}));
      expect(result.structuredContent.ok).toBe(true);
      if(!result.structuredContent.ok)throw Error(result.structuredContent.message);
      const data=(result.structuredContent as AnyToolSuccess).data as {items:unknown[];nextCursor:string|null};
      expect(data.items).toHaveLength(10);expect(data.nextCursor).toBeNull();
      const hashes=hash.mock.calls.length-before;expect(hashes).toBe(temperature==="cold"?10:0);
      runs.push({temperature,pixelHashes:hashes,mcpCalls:1,wireBytes:JSON.stringify(result).length,items:data.items.length,milliseconds:performance.now()-start});
    }
    console.log("SPARSE_REAL_BENCHMARK",JSON.stringify({tiles:50000,tags:10,runs}));
  } finally {hash.mockRestore();tags.dispose();clearTilesetImages();}
},30000);
