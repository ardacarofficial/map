import {
  createDocument,
  FormatError,
  makeCell,
  MapStore,
  PROJECT_FILE_NAME,
  serializeLevel,
  type MapDocument,
  type Tileset,
} from "@smap/core";
import { describe, expect, it, vi } from "vitest";

import { MemoryFileSystem } from "./memoryFs";
import { DEFAULT_LEVEL_PATH, levelName, loadProject, projectFiles, ProjectOpenError, saveProject } from "./projectIo";

const grass: Tileset = {
  id: "grass",
  name: "Grass",
  imagePath: "tilesets/grass.png",
  tileWidth: 32,
  tileHeight: 32,
  columns: 8,
  rows: 8,
  margin: 0,
  spacing: 0,
};
const water: Tileset = { ...grass, id: "water", name: "Water", imagePath: "tilesets/water.png", columns: 4, rows: 2 };

const PNG_GRASS = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const PNG_WATER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9]);
const BYTES: Record<string, Uint8Array> = { grass: PNG_GRASS, water: PNG_WATER };

/** Stands in for createImageBitmap in Node. */
const fakeDecode = async (bytes: Uint8Array) => ({ width: bytes.length, height: 1, close() {} }) as unknown as ImageBitmap;

function sampleStore(): MapStore {
  const store = new MapStore(createDocument({ width: 70, height: 40 }));
  store.dispatch({ type: "addTileset", tileset: grass });
  store.dispatch({ type: "addTileset", tileset: water });
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  const a = store.getOrAddPaletteIndex("grass", 5);
  const b = store.getOrAddPaletteIndex("water", 7);
  store.dispatch({
    type: "paintCells",
    layerId,
    cells: [
      { x: 0, y: 0, cell: makeCell(a) },
      { x: 33, y: 1, cell: makeCell(b) },
      { x: 69, y: 39, cell: makeCell(a) },
    ],
  });
  return store;
}

async function save(fs: MemoryFileSystem, doc: MapDocument, name = "Benim Dünyam") {
  await saveProject(fs, { name, document: doc, levelPath: DEFAULT_LEVEL_PATH, tilesetBytes: (id) => BYTES[id] });
}

describe("saveProject / loadProject", () => {
  it("lists deferred PNGs without encoding and materializes them before project metadata", async () => {
    const fs = new MemoryFileSystem(), store = sampleStore();
    const encode = vi.fn(async () => PNG_GRASS);
    const input = { name: "x", document: store.document, levelPath: DEFAULT_LEVEL_PATH, tilesetBytes: (id: string) => id === "grass" ? encode : PNG_WATER };
    expect(projectFiles(input).map(file => file.path)).toContain("tilesets/grass.png");
    expect(encode).not.toHaveBeenCalled();
    await saveProject(fs, input);
    expect(encode).toHaveBeenCalledOnce();
    expect(fs.files.get("tilesets/grass.png")).toEqual(PNG_GRASS);
    expect([...fs.files.keys()].at(-1)).toBe(PROJECT_FILE_NAME);
  });

  it("does not publish project metadata if deferred PNG encoding fails", async () => {
    const fs = new MemoryFileSystem(), store = sampleStore();
    await expect(saveProject(fs, { name: "x", document: store.document, levelPath: DEFAULT_LEVEL_PATH,
      tilesetBytes: () => async () => { throw new Error("encode failed"); },
    })).rejects.toThrow("encode failed");
    expect(fs.files.has(PROJECT_FILE_NAME)).toBe(false);
  });

  it("round-trips a project through an in-memory folder", async () => {
    const fs = new MemoryFileSystem("benim-dunyam");
    const store = sampleStore();
    await save(fs, store.document);

    const loaded = await loadProject(fs, fakeDecode);
    expect(loaded.name).toBe("Benim Dünyam");
    expect(loaded.levelPath).toBe(DEFAULT_LEVEL_PATH);
    expect(loaded.missingImages).toEqual([]);
    expect(serializeLevel(loaded.document)).toBe(serializeLevel(store.document));
    expect(loaded.document.tilesets).toEqual([grass, water]);
    expect(loaded.document.layers[0]?.getCell(33, 1)).toBe(store.document.layers[0]?.getCell(33, 1));
    expect(loaded.images.map((i) => i.tilesetId)).toEqual(["grass", "water"]);
    expect([...loaded.images[0]!.bytes!]).toEqual([...PNG_GRASS]);
    expect(loaded.images[1]!.bitmap.width).toBe(PNG_WATER.length);
  });

  it("writes the documented folder layout", async () => {
    const fs = new MemoryFileSystem();
    await save(fs, sampleStore().document);
    expect([...fs.files.keys()].sort()).toEqual([
      "levels/main.json",
      PROJECT_FILE_NAME,
      "tilesets/grass.png",
      "tilesets/water.png",
    ]);
    for (const dir of ["levels", "tilesets", "stamps", "backups"]) expect(fs.dirs.has(dir)).toBe(true);
    const project = await fs.readText(PROJECT_FILE_NAME);
    expect(project).toContain('"path": "levels/main.json"');
    expect(project.endsWith("\n")).toBe(true);
  });

  it("is deterministic: save → open → save gives identical bytes", async () => {
    const first = new MemoryFileSystem();
    await save(first, sampleStore().document);
    const loaded = await loadProject(first, fakeDecode);
    const second = new MemoryFileSystem();
    await saveProject(second, {
      name: loaded.name,
      document: loaded.document,
      levelPath: loaded.levelPath,
      tilesetBytes: (id) => loaded.images.find((i) => i.tilesetId === id)?.bytes,
    });
    expect([...second.files.keys()].sort()).toEqual([...first.files.keys()].sort());
    for (const [path, bytes] of first.files) expect(second.files.get(path)).toEqual(bytes);
  });

  it("does not rewrite unchanged tileset images, but writes changed ones", async () => {
    const fs = new MemoryFileSystem();
    const store = sampleStore();
    await save(fs, store.document);
    const writes: string[] = [];
    const original = fs.writeBytes.bind(fs);
    fs.writeBytes = async (path, bytes) => {
      writes.push(path);
      await original(path, bytes);
    };
    await save(fs, store.document);
    expect(writes.filter((p) => p.startsWith("tilesets/"))).toEqual([]);

    BYTES.grass = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 4, 4, 4]);
    try {
      await save(fs, store.document);
      expect(writes.filter((p) => p.startsWith("tilesets/"))).toEqual(["tilesets/grass.png"]);
    } finally {
      BYTES.grass = PNG_GRASS;
    }
  });

  it("saves edits made after the first save", async () => {
    const fs = new MemoryFileSystem();
    const store = sampleStore();
    await save(fs, store.document);
    const layerId = store.document.layers[0]!.id;
    store.dispatch({ type: "paintCells", layerId, cells: [{ x: 0, y: 0, cell: 0 }] });
    await save(fs, store.document);
    const loaded = await loadProject(fs, fakeDecode);
    expect(loaded.document.layers[0]?.getCell(0, 0)).toBe(0);
    expect(serializeLevel(loaded.document)).toBe(serializeLevel(store.document));
  });

  it("keeps the existing image when its bytes are not in memory", async () => {
    const fs = new MemoryFileSystem();
    const store = sampleStore();
    await save(fs, store.document);
    await saveProject(fs, { name: "x", document: store.document, levelPath: DEFAULT_LEVEL_PATH, tilesetBytes: () => undefined });
    expect(fs.files.get("tilesets/grass.png")).toEqual(PNG_GRASS);
  });

  it("opens a project whose tileset image is missing and reports it", async () => {
    const fs = new MemoryFileSystem();
    await save(fs, sampleStore().document);
    fs.files.delete("tilesets/water.png");
    const loaded = await loadProject(fs, fakeDecode);
    expect(loaded.missingImages).toEqual(["tilesets/water.png"]);
    expect(loaded.images.map((i) => i.tilesetId)).toEqual(["grass"]);
    expect(loaded.document.tilesets).toHaveLength(2);
  });

  it("reports a folder without project.smap", async () => {
    const error = await loadProject(new MemoryFileSystem(), fakeDecode).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectOpenError);
    expect((error as ProjectOpenError).problem).toBe("noProjectFile");
  });

  it("surfaces malformed files as FormatError", async () => {
    const fs = new MemoryFileSystem();
    await save(fs, sampleStore().document);
    await fs.writeText(DEFAULT_LEVEL_PATH, '{"format":"smap-level"');
    await expect(loadProject(fs, fakeDecode)).rejects.toBeInstanceOf(FormatError);
    await fs.writeText(PROJECT_FILE_NAME, '{"format":"something-else"}');
    await expect(loadProject(fs, fakeDecode)).rejects.toBeInstanceOf(FormatError);
  });
});

describe("MemoryFileSystem", () => {
  it("lists only direct children files", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeText("a.txt", "a");
    await fs.writeText("levels/main.json", "{}");
    await fs.writeText("levels/deep/x.json", "{}");
    expect(await fs.list("")).toEqual(["a.txt"]);
    expect(await fs.list("levels")).toEqual(["main.json"]);
    expect(await fs.list("nope")).toEqual([]);
  });
});

describe("levelName", () => {
  it("strips folder and extension", () => {
    expect(levelName("levels/main.json")).toBe("main");
    expect(levelName("x")).toBe("x");
  });
});
