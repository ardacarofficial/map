import { describe, expect, it, vi } from "vitest";
import { createDocument, MapStore, makeCell } from "@smap/core";
import { godotPlugin, godotTarget } from "./godot";
import { godotFixture, fixturePng } from "../../../../core/test/fixtures/godot/input";
import { MemoryFileSystem } from "../../io/memoryFs";
import { writeExportFiles } from "../exportFiles";
import { t } from "../../i18n";

describe("Godot target plugin", () => {
  it("exposes translated labels/options and writes a materialized plan through the existing writer", async () => {
    const { store, bytes } = godotFixture();
    const deferred = vi.fn(async () => bytes("a-road"));
    const input = { maps: [{ doc: store.document, name: "main" }], bytes: () => deferred, options: { resourceRoot: "maps" } };
    expect(godotTarget.id).toBe("godot");
    expect(t(godotTarget.labelKey)).toBe("Godot 4");
    for (const option of godotTarget.options) expect(t(option.labelKey)).not.toBe(option.labelKey);
    expect(await godotTarget.preflight(input)).toEqual([]);
    const set = await godotTarget.planFiles(input);
    expect(set.mapFile).toBe("maps/main/main.tscn");
    const fs = new MemoryFileSystem();
    const first = await writeExportFiles(fs, set.files);
    expect(first.written).toEqual(["maps/main/road.png", "maps/main/items.png", "maps/main/tileset.tres", "maps/main/main.json", "maps/main/main.tscn"]);
    expect((await writeExportFiles(fs, set.files)).written).toEqual([]);
  });

  it("blocks missing images and translates every returned problem", async () => {
    const { store } = godotFixture();
    const input = { maps: [{ doc: store.document, name: "main" }], bytes: () => undefined };
    const problems = await godotTarget.preflight(input);
    expect(problems).toHaveLength(2);
    for (const p of problems) expect(t(p.key, p.params)).not.toContain("godotExport.");
    await expect(godotTarget.planFiles(input)).rejects.toMatchObject({ name: "GodotPreflightError" });
  });

  it("captures cells before asynchronous generated PNG encoding and reports encode failures as preflight problems", async () => {
    const { store } = godotFixture();
    const before = store.document.getLayer("ground")!.getCell(0,0);
    const input = { maps: [{ doc: store.document, name: "main" }], bytes: () => async () => {
      store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ x: 0, y: 0, cell: makeCell(0) }] });
      return fixturePng(36,36);
    } };
    const plan = await godotTarget.planFiles(input);
    expect(before).not.toBe(0);
    const json = plan.files.find(f => f.path.endsWith(".json"))!.data as string;
    expect((JSON.parse(json) as { layers: { cells: number[] }[] }).layers[0]!.cells).toHaveLength(40);
    const failure = { ...input, bytes: () => async (): Promise<Uint8Array> => { throw new Error("encode failed"); } };
    expect((await godotTarget.preflight(failure)).map(p => p.key)).toContain("godotExport.invalidImage");
  });
});

// Exercise the actual single-map host contract and common writer, sequentially.
it("keeps both maps and their collision source ids after sequential exports to one destination", async () => {
  const fs = new MemoryFileSystem();
  const { store: a, bytes } = godotFixture();
  const b = new MapStore(createDocument({ ...a.document.map, tilesets: [a.document.tilesets[1]!] }));
  b.dispatch({ type: "addLayer", layer: { id: "blue", name: "Blue" } });
  b.dispatch({ type: "paintCells", layerId: "blue", cells: [{ x: 0, y: 0, cell: makeCell(b.getOrAddPaletteIndex("b-items", 0)) }] });
  const inputA = { doc: a.document, levelName: "A", bytes }, inputB = { doc: b.document, levelName: "B", bytes };
  expect(await godotPlugin.preflight(inputA, {})).toEqual([]);
  await writeExportFiles(fs, await godotPlugin.planFiles(inputA, {}));
  const first = new Map(fs.files);
  expect(await godotPlugin.preflight(inputB, {})).toEqual([]);
  await writeExportFiles(fs, await godotPlugin.planFiles(inputB, {}));
  for (const [path, data] of first) expect(await fs.readBytes(path), path).toEqual(data);
  expect(await fs.readText("smap/A/A.tscn")).toContain('res://smap/A/tileset.tres');
  expect(await fs.readText("smap/B/B.tscn")).toContain('res://smap/B/tileset.tres');
  expect(await fs.readText("smap/A/tileset.tres")).toContain('res://smap/A/road.png');
  expect(await fs.readText("smap/B/tileset.tres")).toContain('res://smap/B/items.png');
});

it("isolates equally named maps by stable identity on case-insensitive destinations", async () => {
  const fs = new MemoryFileSystem();
  const { store, bytes } = godotFixture();
  const scenes: string[] = [];
  let first: Map<string, Uint8Array> | undefined;
  for (const levelId of ["A", "a"]) {
    const input = { doc: store.document, levelName: "Same", levelId, bytes };
    const plan = await godotPlugin.planFiles(input, {});
    scenes.push(plan.find(f => f.path.endsWith(".tscn"))!.path);
    await writeExportFiles(fs, plan);
    if (first) for (const [path, data] of first) expect(await fs.readBytes(path), path).toEqual(data);
    else first = new Map(fs.files);
  }
  expect(new Set(scenes.map(path => path.toLowerCase())).size).toBe(2);
});
