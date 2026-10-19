import { describe, expect, it, vi } from "vitest";
import { makeCell } from "@smap/core";
import { godotTarget } from "./godot";
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
    expect(set.mapFile).toBe("maps/main.tscn");
    const fs = new MemoryFileSystem();
    const first = await writeExportFiles(fs, set.files);
    expect(first.written).toEqual(["maps/road.png", "maps/items.png", "maps/tileset.tres", "maps/main.json", "maps/main.tscn"]);
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
