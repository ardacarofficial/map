import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, readOpfsText, test } from "../support/fixtures";

// The target registry/dialog is owned by lane E. Exercise its exact plugin/writer boundary in a real browser.
const coreFixture = fileURLToPath(new URL("../../packages/core/test/fixtures/godot/input.ts", import.meta.url));
const png = [...readFileSync(new URL("../../packages/core/test/fixtures/godot/project/smap/road.png", import.meta.url))];

test("Godot target plans shared resources, freezes deferred assets and writes deterministic OPFS files", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async ({ fixturePath, png }) => {
    const targetPath = "/src/export/targets/godot.ts", writerPath = "/src/export/exportFiles.ts", fsPath = "/src/io/browserFs.ts";
    const { godotTarget } = await import(targetPath);
    const { godotFixture } = await import(`/@fs${fixturePath}`);
    const { writeExportFiles } = await import(writerPath);
    const { DirectoryHandleFileSystem } = await import(fsPath);
    const { store } = godotFixture();
    const input = { maps: [{ doc: store.document, name: "main" }], bytes: () => async () => new Uint8Array(png), options: { resourceRoot: "godot/maps" } };
    const snapshot = await godotTarget.snapshot(input);
    const problems = await godotTarget.preflight(snapshot);
    const plan = await godotTarget.planFiles(snapshot);
    const fs = new DirectoryHandleFileSystem(await navigator.storage.getDirectory());
    const first = await writeExportFiles(fs, plan.files), repeated = await writeExportFiles(fs, plan.files);
    const missing = await godotTarget.preflight({ ...input, bytes: () => undefined });
    return { problems, first, repeated, missing, mapFile: plan.mapFile };
  }, { fixturePath: coreFixture, png });
  expect(result.problems).toEqual([]);
  expect(result.mapFile).toBe("godot/maps/main.tscn");
  expect(result.first.written).toHaveLength(5);
  expect(result.repeated.written).toEqual([]);
  expect(result.missing.map((p: { key: string }) => p.key)).toEqual(["godotExport.missingImage", "godotExport.missingImage"]);
  const scene = await readOpfsText(page, "godot/maps/main.tscn");
  expect(scene).toContain('path="res://godot/maps/tileset.tres"');
  expect(scene).toContain("tile_map_data = PackedByteArray(0, 0,");
  expect(await readOpfsText(page, "godot/maps/tileset.tres")).toContain("physics_layer_0/polygon_0/points");
  expect(JSON.parse((await readOpfsText(page, "godot/maps/main.json"))!).smapExport).toBe(1);
});
