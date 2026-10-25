/** Deterministic MCP task workloads, not an LLM benchmark.
 * MAP_TASK_METRICS_OUTPUT=/absolute/path.json records the current implementation.
 * MAP_TASK_METRICS_MODE=batch uses the optimized placement API when available.
 */
import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { serializeLevel } from "@smap/core";
import { harness, stamp, tile } from "./helpers";
import type { AgentToolResult, ToolName } from "../src/contracts";

it("runs reproducible bounded MCP task metrics", async () => {
  const rows: Record<string, unknown>[] = [];
  const optimized = process.env.MAP_TASK_METRICS_MODE === "batch";
  const baseline = process.env.MAP_TASK_METRICS_EXPECT_BASELINE === "1";
  function measured(h: ReturnType<typeof harness>) {
    const m = { calls: 0, requestBytes: 0, textBytes: 0, imageBytes: 0, wireBytes: 0, durationMs: 0, failures: [] as string[] };
    async function call(name: ToolName, args: unknown) {
      const start = performance.now();
      const r: AgentToolResult = await h.run(name, args);
      m.durationMs += performance.now() - start;
      m.calls++; m.requestBytes += Buffer.byteLength(JSON.stringify({name, arguments: args}));
      m.wireBytes += Buffer.byteLength(JSON.stringify(r));
      for (const c of r.content) { if (c.type === "text") m.textBytes += Buffer.byteLength(c.text); else m.imageBytes += Buffer.from(c.data,"base64").length; }
      if (!r.structuredContent.ok) m.failures.push(r.structuredContent.code);
      return r;
    }
    return { m, call, read: (name: ToolName, args: Record<string, unknown>) => call(name, {context:h.context(), ...args}), edit: (name: ToolName, args: Record<string, unknown>) => call(name, {context:h.writeContext(), ...args}) };
  }
  {
    const h = harness({width:64,height:64}), b = measured(h), s = h.host.stores.get("map-1")!;
    for (const id of ["upper", "detail"]) s.dispatch({type:"addLayer",layer:{id,name:id,type:"tile"}});
    await h.begin();
    const r = await b.read("read_region", {mapId:"map-1",region:{x:0,y:0,width:64,height:64},layerIds:["ground","upper","detail","collision"]});
    expect(r.structuredContent.ok).toBe(true);
    const text = r.content[0]; expect(text?.type).toBe("text");
    if (text?.type === "text") expect(JSON.parse(text.text)).toEqual(r.structuredContent);
    rows.push({task:"four-layer-64x64-read",...b.m,correct:true});
    await h.api.userAction("discard");
  }
  {
    const h = harness({stamps:[stamp]}), b = measured(h), before = serializeLevel(h.host.stores.get("map-1")!.document); await h.begin();
    const placements = Array.from({length:16}, (_,i)=>({mapId:"map-1",stampId:"house",at:{x:(i%4)*3,y:Math.floor(i/4)*3}}));
    if (optimized) await b.edit("apply_operations" as ToolName, {operations:placements.map(args=>({tool:"place_stamp",args:{...args,layerMapping:[{sourceLayerId:"base",targetLayerId:"ground"}]}}))});
    else for (const args of placements) await b.edit("place_stamp",args);
    const painted = Array.from({length:16},(_,i)=>h.host.stores.get("map-1")!.document.getLayer("ground")!.getCell((i%4)*3,Math.floor(i/4)*3)).filter(Boolean).length;
    await b.read("validate_map",{mapId:"map-1"});
    await b.edit("finish_edit",{summary:"Sixteen houses"}); await h.api.userAction("approve");
    h.host.history.undo(); const undoExact = serializeLevel(h.host.stores.get("map-1")!.document) === before;
    h.host.history.redo(); const redoPlaced = h.host.stores.get("map-1")!.document.getLayer("ground")!.getCell(0,0) !== 0;
    rows.push({task:"sixteen-house-village",...b.m,placed:painted,undoExact,redoPlaced});
    expect(painted).toBe(16); expect(undoExact).toBe(true); expect(redoPlaced).toBe(true);
  }
  {
    const h = harness({width:64,height:64,tilesets:[{id:"tiles",name:"Large",tileWidth:1,tileHeight:1,columns:4096,rows:1,margin:0,spacing:0,imagePath:"large.png"}]}),b=measured(h),before=h.host.snapshot(); await h.begin();
    const r = await b.edit("paint_cells",{mapId:"map-1",layerId:"ground",cells:Array.from({length:4096},(_,tileId)=>({x:tileId%64,y:Math.floor(tileId/64),value:{tilesetId:"tiles",tileId}}))});
    const changed = h.host.stores.get("map-1")!.document.getLayer("ground")!.getCell(63,63)!==0;
    await h.api.userAction("discard"); const discardExact = JSON.stringify(h.host.snapshot())===JSON.stringify(before);
    rows.push({task:"4096-distinct-tiles",...b.m,success:r.structuredContent.ok,changed,discardExact}); expect(discardExact).toBe(true);
    expect(r.structuredContent.ok).toBe(!baseline); expect(changed).toBe(!baseline);
  }
  {
    const h=harness(),b=measured(h); await h.begin();
    await b.edit("paint_cells",{mapId:"map-1",layerId:"ground",cells:[{x:12,y:12,value:tile}]});
    const prepared=await b.edit("prepare_smart_source",{mapId:"map-1",source:{tilesetId:"tiles",region:{x:0,y:0,width:3,height:3}},force:true});
    if (!prepared.structuredContent.ok) throw Error("prepare source failed");
    const data=prepared.structuredContent as unknown as {created:{sourceId:string}};
    await b.edit("smart_brush",{mapId:"map-1",layerId:"ground",sourceId:data.created.sourceId,mode:"area"});
    const priorWorkPreserved = h.host.stores.get("map-1")!.document.getLayer("ground")!.getCell(12,12)!==0;
    rows.push({task:"malformed-brush-recovery",...b.m,priorWorkPreserved,transactionState:h.api.getState().transaction?.state});
    expect(priorWorkPreserved).toBe(!baseline);
    expect(b.m.failures).toEqual([baseline ? "INTERNAL_ERROR" : "INVALID_ARGUMENT"]);
    await h.api.userAction("discard");
  }
  if (process.env.MAP_TASK_METRICS_OUTPUT) writeFileSync(process.env.MAP_TASK_METRICS_OUTPUT,JSON.stringify({kind:"deterministic in-process MCP API tasks",mode:optimized?"batch":"individual",timing:"single-run local wall clock; no network or LLM inference",rows},null,2)+"\n");
});
