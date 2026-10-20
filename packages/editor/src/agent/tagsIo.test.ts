import { describe, expect, it, vi } from "vitest";
import type { AgentCallContext, AgentImagePort, AgentWorldPort } from "@smap/agent";
import { MemoryFileSystem } from "../io/memoryFs";
import { createTagsPort, serializeTagsSidecar, parseTagsSidecar } from "./tagsIo";
const fp="a".repeat(64), next="b".repeat(64);
const call={clientSessionId:"test",clientInfo:{name:"test",version:"1"},bridgeEpoch:"test",deadline:Date.now()+30000,signal:{aborted:false,throwIfAborted(){},onAbort:()=>()=>{}}} as AgentCallContext;
const world={tilesets:()=>[{id:"art",columns:1,rows:1}],stamps:()=>[]} as unknown as AgentWorldPort;
function port(fs:MemoryFileSystem, fingerprint=()=>fp){return createTagsPort({world,images:{tileFingerprint:async()=>fingerprint()} as unknown as AgentImagePort,folder:()=>fs,worldId:()=>"world"});}
const args={context:{worldSessionId:"world",idempotencyKey:"tags-0001"},entries:[{target:{kind:"tile" as const,tilesetId:"art",tileId:0},expectedFingerprint:fp,tags:[" grass ","grass","e\u0301"],note:"Ground"}]};
describe("independent AI tags persistence",()=>{
  it("writes canonical words and keeps stale annotations when pixels change",async()=>{
    const fs=new MemoryFileSystem();let current=fp;const tags=port(fs,()=>current);await tags.reload();
    await tags.set(args,call);await tags.flush();
    const text=await fs.readText("ai-tags.json");expect(text).toContain('"tagFormatVersion": 1');expect(text.endsWith("\n")).toBe(true);
    expect(parseTagsSidecar(text).tiles[0]!.tags).toEqual(["grass","é"]);
    current=next;const result=await tags.get({context:{worldSessionId:"world"},status:"stale"},call);
    expect(result.items[0]).toMatchObject({status:"stale",tags:["grass","é"],storedFingerprint:fp,currentFingerprint:next});tags.dispose();
  });
  it("preserves malformed/future files byte-for-byte and refuses writes",async()=>{
    const fs=new MemoryFileSystem(),original='{"format":"smap-ai-tags","tagFormatVersion":7,"secret":"keep"}';await fs.writeText("ai-tags.json",original);
    const tags=port(fs);await tags.reload();expect(tags.availability()).toMatchObject({state:"unavailable",reason:"futureVersion"});
    await expect(tags.set(args,call)).rejects.toThrow();await tags.flush();expect(await fs.readText("ai-tags.json")).toBe(original);tags.dispose();
  });
  it("debounces for at most 500ms, independent of any map save",async()=>{
    vi.useFakeTimers();const fs=new MemoryFileSystem(),tags=port(fs);await tags.reload();await tags.set(args,call);
    await vi.advanceTimersByTimeAsync(500);expect(await fs.readText("ai-tags.json")).toContain('"grass"');tags.dispose();vi.useRealTimers();
  });
  it("does not overwrite a future sidecar already present at a Save As destination",async()=>{
    const source=new MemoryFileSystem(),target=new MemoryFileSystem();let folder=source;
    const tags=createTagsPort({world,images:{tileFingerprint:async()=>fp} as unknown as AgentImagePort,folder:()=>folder,worldId:()=>"world"});
    await tags.set(args,call);await tags.flush();
    const original='{"format":"smap-ai-tags","tagFormatVersion":9,"keep":"future"}';await target.writeText("ai-tags.json",original);folder=target;
    await tags.folderChanged();expect(await target.readText("ai-tags.json")).toBe(original);expect(tags.availability()).toMatchObject({state:"unavailable",reason:"futureVersion"});tags.dispose();
  });
  it("a failed atomic write retains the previous sidecar and can retry the complete new batch",async()=>{
    const fs=new MemoryFileSystem(),tags=port(fs);await tags.set(args,call);await tags.flush();const old=await fs.readText("ai-tags.json");
    await tags.set({...args,entries:[{...args.entries[0]!,tags:["water"]}]},call);
    const write=vi.spyOn(fs,"writeText").mockRejectedValueOnce(Error("disk full"));await expect(tags.flush()).rejects.toThrow("disk full");
    expect(await fs.readText("ai-tags.json")).toBe(old);write.mockRestore();await tags.flush();expect(await fs.readText("ai-tags.json")).toContain('"water"');tags.dispose();
  });
  it("rejects duplicate identities and uses code-unit ordering",()=>{
    const empty={format:"smap-ai-tags" as const,tagFormatVersion:1 as const,tiles:[],stamps:[]};
    expect(serializeTagsSidecar(empty)).toBe('{\n  "format": "smap-ai-tags",\n  "tagFormatVersion": 1,\n  "tiles": [],\n  "stamps": []\n}\n');
    expect(()=>parseTagsSidecar(JSON.stringify({...empty,tiles:[{tilesetId:"a",tileId:0,fingerprint:fp,tags:[],note:""},{tilesetId:"a",tileId:0,fingerprint:fp,tags:[],note:""}]}))).toThrow();
  });
});
