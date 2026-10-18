import { describe, expect, it } from "vitest";

import { MemoryFileSystem } from "../io/memoryFs";
import { tmjExportFiles, unityExportFiles, writeExportFiles } from "./exportFiles";
import { BYTES, sampleStore } from "./testDoc";

const bytes = (id: string) => BYTES[id];
const decode = (data: string | Uint8Array) => (typeof data === "string" ? data : new TextDecoder().decode(data));

describe("unityExportFiles", () => {
  it("writes the used tileset PNGs (unique names) and then <level>.smapmap", () => {
    const { store } = sampleStore();
    const set = unityExportFiles(store.document, "main", bytes);
    expect(set.mapFile).toBe("main.smapmap");
    expect(set.files.map((f) => f.path)).toEqual(["grass.png", "grass-2.png", "main.smapmap"]);
    expect(set.files[0]!.data).toEqual(BYTES.grass);
    expect(set.files[1]!.data).toEqual(BYTES.grass2);
    const map = JSON.parse(decode(set.files[2]!.data)) as { smapExport: number; tilesets: { image: string }[] };
    expect(map.smapExport).toBe(1);
    expect(map.tilesets.map((ts) => ts.image)).toEqual(["grass.png", "grass-2.png"]);
    expect(set.missingImages).toEqual([]);
    expect(set.warnings).toEqual([]);
  });

  it("sanitizes the level name and reports images missing from the registry", () => {
    const { store } = sampleStore();
    const set = unityExportFiles(store.document, "a:b", (id) => (id === "grass" ? BYTES.grass : undefined));
    expect(set.files.map((f) => f.path)).toEqual(["grass.png", "a_b.smapmap"]);
    expect(set.missingImages).toEqual(["tilesets/other/grass.png"]);
  });
});

describe("tmjExportFiles", () => {
  it("writes <level>.tmj next to the tileset PNGs", () => {
    const { store } = sampleStore();
    const set = tmjExportFiles(store.document, "main", bytes);
    expect(set.files.map((f) => f.path)).toEqual(["grass.png", "grass-2.png", "main.tmj"]);
    const tmj = JSON.parse(decode(set.files[2]!.data)) as { tilesets: { image: string }[] };
    expect(tmj.tilesets.map((ts) => ts.image)).toEqual(["grass.png", "grass-2.png"]);
  });

  it("exports manual collision without a loss warning", () => {
    const { store } = sampleStore();
    const collision = store.dispatch({ type: "addLayer", layer: { name: "Walls", type: "grid", role: "collision" } });
    store.dispatch({ type: "paintGrid", layerId: collision, cells: [{ x: 0, y: 0, value: 1 }] });
    const set = tmjExportFiles(store.document, "main", bytes);
    expect(set.warnings).toEqual([]);
  });
});

describe("writeExportFiles", () => {
  it("writes every file, then skips files whose bytes did not change", async () => {
    const fs = new MemoryFileSystem("Maps");
    const { store, ground } = sampleStore();
    const first = await writeExportFiles(fs, unityExportFiles(store.document, "main", bytes).files);
    expect(first.written).toEqual(["grass.png", "grass-2.png", "main.smapmap"]);
    expect(await fs.list("")).toEqual(["grass-2.png", "grass.png", "main.smapmap"]);

    const again = await writeExportFiles(fs, unityExportFiles(store.document, "main", bytes).files);
    expect(again.written).toEqual([]);

    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 1, y: 2, cell: 0 }, { x: 0, y: 0, cell: 0 }] });
    const changed = await writeExportFiles(fs, unityExportFiles(store.document, "main", bytes).files);
    expect(changed.written).toEqual(["main.smapmap"]);
    expect(changed.unchanged).toEqual(["grass.png", "grass-2.png"]);
  });
});
