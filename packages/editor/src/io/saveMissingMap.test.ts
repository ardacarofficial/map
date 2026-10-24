/**
 * T-06: a world whose project.smap lists a map file that is gone (seen after
 * an AI-created map and many approve/discard cycles) failed EVERY later save in
 * protectSavedProject with "File not found: levels/<map>.json", and the toast
 * blamed a tileset image. Saving must keep working and rewrite the file from
 * memory; the message must name the map file.
 */
import { createDocument, makeCell, MapStore, parseProject, PROJECT_FILE_NAME, serializeLevel, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";

import { FileNotFoundError } from "./fs";
import { LevelWorkspace } from "./levelWorkspace";
import { MemoryFileSystem } from "./memoryFs";
import { defaultLevels, loadProject } from "./projectIo";
import { protectSavedProject } from "./saveRecovery";
import { describeError, describeMissingFile } from "./session";

const grass: Tileset = { id: "grass", name: "Grass", imagePath: "tilesets/grass.png", tileWidth: 32, tileHeight: 32, columns: 8, rows: 8, margin: 0, spacing: 0 };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
const input = { tilesetBytes: () => PNG };
const decode = async () => ({ width: 1, height: 1, close() {} }) as unknown as ImageBitmap;

function world(): LevelWorkspace {
  const store = new MapStore(createDocument({ width: 8, height: 8, tilesets: [grass] }));
  store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  store.clearHistory();
  const levels = defaultLevels("levels/main.json");
  return new LevelWorkspace({ name: "Köy", levels, active: { id: levels[0]!.id, store, knownText: null } });
}
function paint(store: MapStore, x: number): void {
  const layer = store.document.layers.find(l => l.type === "tile")!;
  store.dispatch({ type: "paintCells", layerId: layer.id, cells: [{ x, y: 0, cell: makeCell(store.getOrAddPaletteIndex("grass", 1)) }] });
}
async function listedFilesExist(fs: MemoryFileSystem): Promise<string[]> {
  const missing: string[] = [];
  for (const level of parseProject(await fs.readText(PROJECT_FILE_NAME)).levels) if (!fs.files.has(level.path)) missing.push(level.path);
  return missing;
}

describe("saving a world whose project lists a missing map file", () => {
  it("keeps saving and rewrites the loaded map from memory", async () => {
    const fs = new MemoryFileSystem(), ws = world();
    const zindan = ws.add({ name: "Zindan", width: 6, height: 6, tileSize: 32, layerName: "Zemin" });
    await ws.save(fs, input);
    const text = await fs.readText(zindan.path);
    expect(ws.isDirty(zindan.id)).toBe(false);

    await fs.remove(zindan.path); // the broken state from the T-06 run
    paint(ws.active.store, 1);
    ws.markDirty();

    await expect(ws.save(fs, input)).resolves.toBeDefined();
    expect(await listedFilesExist(fs)).toEqual([]);
    expect(await fs.readText(zindan.path)).toBe(text);
    expect(serializeLevel(ws.entry(zindan.id)!.store.document)).toBe(text);
    // ...and the world opens on that map again.
    expect((await loadProject(fs, decode, { levelId: zindan.id })).levelPath).toBe(zindan.path);
    // No backup snapshots are left behind by the healed save.
    expect([...fs.files.keys()].filter(p => p.startsWith("backups/save/"))).toEqual([]);
  });

  it("does not fail every save when an unloaded map's file is gone", async () => {
    const fs = new MemoryFileSystem(), ws = world();
    const other = ws.add({ name: "Kule", width: 6, height: 6, tileSize: 32, layerName: "Zemin" });
    await ws.save(fs, input);
    // Open Kule and come back: the clean map without history is dropped from memory.
    await ws.activate(other.id, fs);
    await ws.activate(ws.levels[0]!.id, fs);
    expect(ws.entry(other.id)).toBeUndefined();
    await fs.remove(other.path);
    paint(ws.active.store, 2);
    ws.markDirty();
    await expect(ws.save(fs, input)).resolves.toBeDefined();
    await expect(ws.save(fs, input)).resolves.toBeDefined();
    expect(await listedFilesExist(fs)).toEqual([other.path]);
  });

  it("protectSavedProject publishes a backup root although a listed map is missing", async () => {
    const fs = new MemoryFileSystem(), ws = world();
    const zindan = ws.add({ name: "Zindan", width: 6, height: 6, tileSize: 32, layerName: "Zemin" });
    await ws.save(fs, input);
    await fs.remove(zindan.path);
    await expect(protectSavedProject(fs)).resolves.toBeUndefined();
    // The protected root points at snapshots, so an interrupted save can recover.
    const root = parseProject(await fs.readText(PROJECT_FILE_NAME));
    expect(root.levels.every(l => l.path.startsWith("backups/save/"))).toBe(true);
    // Opening recovers the previous root (still listing the map) without throwing.
    await expect(loadProject(fs, decode)).resolves.toMatchObject({ levelPath: "levels/main.json" });
  });
});

describe("missing file messages", () => {
  it("names a map file as a map, not as a tileset image", () => {
    expect(describeError(new FileNotFoundError("levels/zindan.json"))).toBe("Harita dosyası bulunamadı: levels/zindan.json");
    expect(describeMissingFile("tilesets/grass.png")).toBe("Tileset görseli bulunamadı: tilesets/grass.png");
    expect(describeMissingFile("stamps/ev.json")).toBe("Dosya bulunamadı: stamps/ev.json");
  });
});
