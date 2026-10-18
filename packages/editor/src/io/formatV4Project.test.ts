import { describe, expect, it } from "vitest";
import { applySmartStampRoad, MapStore, roadMembership, parseLevel, serializeLevel, serializeStamp } from "@smap/core";
import oldProject from "../../../core/test/fixtures/v15/v3-project.json";
import mirroredProject from "../../../core/test/fixtures/v15/v3-mirrored-unrelated-project.json";
import preRoleOne from "../../../core/test/fixtures/v15/v1-pre-role-1-stamp.json";
import preRoleThree from "../../../core/test/fixtures/v15/v1-pre-role-3-stamp.json";
import oldLevel from "../../../core/test/fixtures/v15/v3-level.json";
import oldStamp from "../../../core/test/fixtures/v15/v3-stamp.json";
import { MemoryFileSystem } from "./memoryFs";
import { loadProject, saveProject } from "./projectIo";

const decode = async () => ({width:256,height:256,close(){}} as unknown as ImageBitmap);
const sourcePng = new Uint8Array([137,80,78,71,1]), bankPng = new Uint8Array([137,80,78,71,2]);

describe("legacy smart recipes through project IO", () => {
  for(const source of ["sidecar","root","library"] as const) it(`loads ${source} provenance, preserves the disk, and saves/reopens it after library deletion in another folder`,async()=>{
    const fs=new MemoryFileSystem("Old");
    await fs.writeText("project.smap",JSON.stringify(source==="root"?oldProject:{...oldProject,generatedRecipes:[]}));
    await fs.writeText("levels/main.json",JSON.stringify(oldLevel));
    if(source==="sidecar")await fs.writeText("tilesets/baked.recipe.json",JSON.stringify(oldStamp));
    if(source==="library")await fs.writeText("stamps/road.json",JSON.stringify(oldStamp));
    await fs.writeBytes("tilesets/source.png",sourcePng);await fs.writeBytes("tilesets/baked.png",bankPng);
    const projectBefore=await fs.readText("project.smap"), loaded=await loadProject(fs,decode);
    expect(loaded.brokenStamps).toEqual([]);expect(loaded.generatedRecipes).toHaveLength(1);
    const recipe=loaded.generatedRecipes[0]!;
    expect(recipe.stamp.layers.map(l=>l.layerId)).toEqual(["s"]);
    expect(recipe.stamp.nineSlice!.road!.profile.tiles).toHaveLength(63);
    expect(await fs.readText("project.smap")).toBe(projectBefore);
    const closedLevel=parseLevel(JSON.stringify(oldLevel),loaded.document.tilesets);
    const next=new MemoryFileSystem("Save As");
    await saveProject(next,{name:loaded.name,document:loaded.document,levelPath:loaded.levelPath,levels:loaded.levels,stamps:[],generatedRecipes:loaded.generatedRecipes,otherLevels:[{path:"levels/closed.json",document:closedLevel}],tilesetBytes:id=>id==="source"?sourcePng:bankPng});
    expect(JSON.parse(await next.readText("project.smap")).documentFormatVersion).toBe(4);
    expect(await next.readText("tilesets/baked.recipe.json")).not.toMatch(/"(?:terrains|terrainSets|solidTiles|terrainId|setId)"/);
    const reopened=await loadProject(next,decode);
    expect(reopened.stamps).toEqual([]);expect(reopened.generatedRecipes).toHaveLength(1);
    expect(reopened.generatedRecipes[0]!.stamp.nineSlice).toEqual(recipe.stamp.nineSlice);
    expect(serializeLevel(reopened.document)).toBe(serializeLevel(loaded.document));
    expect(await next.readText("levels/closed.json")).toBe(serializeLevel(closedLevel));
    expect(await next.readBytes("tilesets/source.png")).toEqual(sourcePng);expect(await next.readBytes("tilesets/baked.png")).toEqual(bankPng);
  });
  for (const source of ["sidecar", "root", "library"] as const) it(`keeps the exact referenced family for ${source} migration and Save As/reopen`, async () => {
    const fs = new MemoryFileSystem("Mirrored family");
    await fs.writeText("project.smap", JSON.stringify(source === "root" ? mirroredProject : { ...mirroredProject, generatedRecipes: [] }));
    await fs.writeText("levels/main.json", JSON.stringify(oldLevel));
    if (source === "sidecar") await fs.writeText("tilesets/baked.recipe.json", JSON.stringify(oldStamp));
    if (source === "library") await fs.writeText("stamps/road.json", JSON.stringify(oldStamp));
    const loaded = await loadProject(fs, decode);
    expect(loaded.brokenStamps).toEqual([]);
    const stamp = loaded.generatedRecipes[0]!.stamp;
    if (source === "library") expect(serializeStamp(loaded.stamps[0]!)).toBe(serializeStamp(stamp));
    const points = [{ x: 18, y: 12 }, { x: 19, y: 12 }, { x: 20, y: 12 }];
    const stroke = (store: MapStore) => {
      applySmartStampRoad(store, stamp, "tiles", roadMembership(points));
      return points.map(p => store.document.palette.get(store.document.getLayer("tiles")!.getCell(p.x, p.y) & 0x1fffffff)!.tileId);
    };
    const store = new MapStore(loaded.document);
    expect(stroke(store)).toEqual([12, 31, 29]);
    store.undo();
    const next = new MemoryFileSystem("Save As");
    await saveProject(next, { name: loaded.name, document: loaded.document, levelPath: loaded.levelPath, stamps: loaded.stamps, generatedRecipes: loaded.generatedRecipes, tilesetBytes: () => undefined });
    const reopened = await loadProject(next, decode);
    expect(serializeStamp(reopened.generatedRecipes[0]!.stamp)).toBe(serializeStamp(stamp));
    const reopenedStore = new MapStore(reopened.document);
    applySmartStampRoad(reopenedStore, reopened.generatedRecipes[0]!.stamp, "tiles", roadMembership(points));
    expect(points.map(p => reopenedStore.document.palette.get(reopenedStore.document.getLayer("tiles")!.getCell(p.x, p.y) & 0x1fffffff)!.tileId)).toEqual([12, 31, 29]);
    for (const path of ["project.smap", "tilesets/baked.recipe.json", ...(source === "library" ? ["stamps/road.json"] : [])]) {
      expect(await next.readText(path)).not.toMatch(/"(?:terrainSets|terrains|setId|terrainId)"/);
    }
  });

  it("loads pre-role v1 library stamps without turning their terrain grids into collision or marking them broken", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeText("project.smap", JSON.stringify(oldProject));
    await fs.writeText("levels/main.json", JSON.stringify(oldLevel));
    for (const stamp of [preRoleOne, preRoleThree]) await fs.writeText(`stamps/${stamp.id}.json`, JSON.stringify(stamp));
    const loaded = await loadProject(fs, decode);
    expect(loaded.brokenStamps).toEqual([]);
    expect(loaded.stamps).toHaveLength(2);
    for (const stamp of loaded.stamps) expect(stamp.layers.map(l => l.layerId)).toEqual(["s", "collision"]);
  });

  it("marks an old project for an ordinary save even when its level was already migrated",async()=>{
    const fs=new MemoryFileSystem();
    await fs.writeText("project.smap",JSON.stringify(oldProject));
    await fs.writeText("levels/main.json",serializeLevel(parseLevel(JSON.stringify(oldLevel))));
    const loaded=await loadProject(fs,decode);
    expect(loaded.document.migrations).toEqual(["format.migrated"]);
    expect(JSON.parse(await fs.readText("project.smap")).documentFormatVersion).toBe(3);
  });

});
