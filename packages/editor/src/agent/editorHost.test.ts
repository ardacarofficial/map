import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCell, serializeLevel } from "@smap/core";
import type { AgentSignal, CreateMapArgs } from "@smap/agent";
import { browserPlatform, setPlatform } from "../platform";
import { useEditorStore } from "../state/editorStore";
import { useProjectLibrary } from "../io/projectLibrary";
import { MemoryFileSystem } from "../io/memoryFs";
import { autosaveNow, closeProject, getLevelWorkspace, newProject, openLevel, saveCurrentProject, withProjectWriteGate } from "../io/session";
import { createEditorHost } from "./editorHost";
import { editGate, getAgentWorldSessionId } from "./editGate";

const signal: AgentSignal = { aborted: false, throwIfAborted() {}, onAbort: () => () => {} };
let release: (() => void) | undefined;
beforeEach(() => { setPlatform({ ...browserPlatform, watchProject() {} }); });
afterEach(() => { release?.(); release = undefined; closeProject(); vi.useRealTimers(); setPlatform(browserPlatform); });
async function fresh(saved = false) {
  const fs = new MemoryFileSystem();
  await newProject({ name: "Live", width: 8, height: 8, tileSize: 16, ...(saved ? { folder: { fs, label: "Live", ref: "live" } } : {}) });
  return { fs, host: createEditorHost() };
}
function pending() { const edit = editGate.acquireEdit(getAgentWorldSessionId()!); release = () => edit.release("cancelled"); return edit; }

describe("live editor agent adapter", () => {
  it("returns the exact cached store across map tab switches", async () => {
    const { host } = await fresh();
    const ws = getLevelWorkspace()!, first = ws.active.store, firstId = ws.activeId;
    const second = ws.add({ name: "Other", width: 4, height: 4, tileSize: 16, layerName: "Ground" });
    expect(await host.world.loadMap(firstId)).toBe(first);
    await openLevel(second.id);
    expect(await host.world.loadMap(firstId)).toBe(first);
    expect(useEditorStore.getState().project!.store).toBe(ws.entry(second.id)!.store);
    expect(ws.activeId).toBe(second.id);
  });
  it("restores pre-existing map/library dirtiness after rollback without losing palette identity", async () => {
    const { host } = await fresh();
    const ws = getLevelWorkspace()!, store = ws.active.store;
    ws.markDirty(); useEditorStore.getState().setDirty(true);
    const baseline = host.transactions.captureBaseline([ws.activeId]);
    const before = serializeLevel(store.document);
    store.beginTransaction();
    store.dispatch({ type: "setLayerProps", layerId: store.document.layers[0]!.id, props: { name: "Tentative" } });
    store.rollback();
    host.transactions.restoreBaseline(baseline);
    expect(serializeLevel(store.document)).toBe(before);
    expect(ws.isDirty(ws.activeId)).toBe(true);
    expect(useEditorStore.getState().dirty).toBe(true);
    expect(useProjectLibrary.getState().revision).toBe(baseline.metadata.libraryRevision);
  });
  it("restores the exact live palette and existing redo tail after a tentative palette append",async()=>{
    const {host}=await fresh(),ws=getLevelWorkspace()!,store=ws.active.store;
    store.dispatch({type:"addTileset",tileset:{id:"source",name:"Source",imagePath:"tilesets/source.png",tileWidth:16,tileHeight:16,columns:3,rows:1,margin:0,spacing:0}});
    const index=store.getOrAddPaletteIndex("source",0),layerId=store.document.layers[0]!.id;
    store.getOrAddPaletteIndex("source",1); // Deliberately retain an unreferenced baseline entry.
    store.dispatch({type:"paintCells",layerId,cells:[{x:0,y:0,cell:makeCell(index)}]});
    store.dispatch({type:"paintCells",layerId,cells:[{x:1,y:0,cell:makeCell(index)}]});store.undo();
    const baseline=host.transactions.captureBaseline([ws.activeId]),before=serializeLevel(store.document),palette=[...store.document.palette.entries()],history=store.historyEntries();
    store.beginTransaction();const next=store.dispatch({type:"addPaletteEntry",tilesetId:"source",tileId:2,undoable:true});
    store.dispatch({type:"paintCells",layerId,cells:[{x:2,y:0,cell:makeCell(next)}]});store.rollback();host.transactions.restoreBaseline(baseline);
    expect(serializeLevel(store.document)).toBe(before);expect([...store.document.palette.entries()]).toEqual(palette);expect(store.historyEntries()).toEqual(history);expect(store.canRedo).toBe(true);
  });
  it("an approved no-op keeps the clean baseline and does not invent a library edit",async()=>{
    const {host}=await fresh(true),ws=getLevelWorkspace()!,baseline=host.transactions.captureBaseline([ws.activeId]);
    host.metadata.publish();host.transactions.finalized("approved");
    expect(useEditorStore.getState().dirty).toBe(baseline.editorDirty);expect(useProjectLibrary.getState().revision).toBe(baseline.metadata.libraryRevision);expect(ws.dirtyIds()).toEqual([]);
  });
  it("refuses a new begin while the user is asynchronously replacing the world",async()=>{
    const {host}=await fresh(true);
    const replacing=newProject({name:"Replacement",width:4,height:4,tileSize:16});
    try{expect(()=>host.transactions.assertCanBegin()).toThrow();}finally{await replacing;}
  });
  it("opens an uncached map during review with approved project metadata", async () => {
    const {host,fs}=await fresh(true),ws=getLevelWorkspace()!,first=ws.activeId;
    const other=ws.add({name:"Other",width:4,height:4,tileSize:16,layerName:"Ground"});
    await saveCurrentProject(false);await ws.activate(other.id,fs);await ws.activate(first,fs);
    expect(ws.entry(other.id)).toBeUndefined();
    const baseline=host.transactions.captureBaseline([first]),edit=pending();
    const store=ws.active.store;
    store.beginTransaction();store.dispatch({type:"addTileset",tileset:{id:"tentative",name:"Tentative",imagePath:"tilesets/tentative.png",tileWidth:16,tileHeight:16,columns:1,rows:1,margin:0,spacing:0}});
    expect(await openLevel(other.id)).toBe(true);
    expect(ws.active.store.document.getTileset("tentative")).toBeUndefined();
    store.rollback();host.transactions.restoreBaseline(baseline);edit.release("cancelled");host.transactions.finalized("cancelled");
  });
  it("stages a provisional map only on publication and removes it without a pending disk deletion", async () => {
    const { host } = await fresh();
    const ws = getLevelWorkspace()!, original = ws.levels.map(l => l.id);
    const args = { context: {}, name: "Tentative", width: 4, height: 6, tileWidth: 16, tileHeight: 32 } as CreateMapArgs;
    const prepared = await host.world.prepareAgentMap(args, signal);
    expect(ws.levels.map(l => l.id)).toEqual(original);
    host.world.stageAgentMap(prepared);
    expect(await host.loadMap(prepared.map.id)).toBe(prepared.store);
    await openLevel(prepared.map.id);
    host.world.removeProvisionalMap(prepared.map.id);
    expect(ws.levels.map(l => l.id)).toEqual(original);
    expect(ws.removedFiles).toEqual([]);
    expect(ws.cachedIds()).not.toContain(prepared.map.id);
    expect(useEditorStore.getState().project!.store).toBe(ws.active.store);
  });
  it("blocks manual save and autosave throughout pending review without touching disk", async () => {
    const { fs } = await fresh(true);
    const before = await fs.readText("levels/main.json");
    const edit = pending(); await edit.waitForWrites(signal, Date.now() + 1000);
    const store = useEditorStore.getState().project!.store;
    store.dispatch({ type: "setLayerProps", layerId: store.document.layers[0]!.id, props: { name: "Pending" } });
    useEditorStore.getState().setDirty(true);
    vi.useFakeTimers();
    await autosaveNow(); await vi.advanceTimersByTimeAsync(120000);
    expect(await saveCurrentProject(false)).toBe(false);
    expect(await fs.readText("levels/main.json")).toBe(before);
    release!();
    await autosaveNow();
    expect(await fs.readText("levels/main.json")).not.toBe(before);
  });
  it("begin drains an admitted action even when it has not entered the write queue yet", async () => {
    await fresh();
    let complete!: () => void;
    const write = withProjectWriteGate(() => new Promise<void>(resolve => { complete = resolve; }));
    const edit = pending();
    let drained = false;
    const wait = edit.waitForWrites(signal, Date.now() + 1000).then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    complete(); await write; await wait;
    expect(drained).toBe(true);
  });
});
