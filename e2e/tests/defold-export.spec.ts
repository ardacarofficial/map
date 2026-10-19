import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, startWithTileset, test } from "../support/fixtures";

// The dialog/registry is owned by another lane. Exercise the production target
// boundary with the real document, PNG registry and directory writer here.
test("Defold plugin writes a native package through the real browser filesystem", async ({ page }, testInfo) => {
  await page.goto("/");
  await startWithTileset(page);
  const result = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { tilesetPngSource } = await import(/* @vite-ignore */ String("/src/state/tilesetImages.ts"));
    const { defoldTarget } = await import(/* @vite-ignore */ String("/src/export/targets/defold.ts"));
    const { writeExportFiles } = await import(/* @vite-ignore */ String("/src/export/exportFiles.ts"));
    const { DirectoryHandleFileSystem } = await import(/* @vite-ignore */ String("/src/io/browserFs.ts"));
    const project = useEditorStore.getState().project;
    const store = project.store;
    const doc = store.document;
    const layer = doc.layers.find((layer: { type: string }) => layer.type === "tile");
    const tileset = doc.tilesets[0];
    store.dispatch({ type: "paintCells", layerId: layer.id, cells: [
      { x: 0, y: 0, cell: store.getOrAddPaletteIndex(tileset.id, 0) },
      { x: 1, y: 0, cell: store.getOrAddPaletteIndex(tileset.id, 3) },
      { x: 0, y: 1, cell: store.getOrAddPaletteIndex(tileset.id, 7) },
    ] });
    store.dispatch({ type: "addLayer", layer: { id: "defold-col", name: "Collision", type: "grid", role: "collision" } });
    store.dispatch({ type: "paintGrid", layerId: "defold-col", cells: [{ x: 1, y: 1, value: 1 }] });
    const input = { doc, levelName: "room", bytes: tilesetPngSource };
    const options = { projectSubfolder: "exported", collision: true };
    const problems = defoldTarget.preflight(input, options);
    const files = await defoldTarget.planFiles(input, options);
    const root = await navigator.storage.getDirectory();
    const fs = new DirectoryHandleFileSystem(await root.getDirectoryHandle("defold-project", { create: true }));
    const first = await writeExportFiles(fs, files);
    const repeated = await writeExportFiles(fs, await defoldTarget.planFiles(input, options));
    return {
      problems, first, repeated, layerId: layer.id,
      collection: await fs.readText("exported/room/map.collection"),
      tilemap: await fs.readText(files.find((file: { path: string }) => file.path.endsWith(".tilemap")).path),
      collision: await fs.readText("exported/room/collision-0000.collisionobject"),
      game: JSON.parse(await fs.readText("exported/room/game.json")),
      files: await Promise.all(files.map(async (file: { path: string }) => ({ path: file.path, bytes: [...await fs.readBytes(file.path)] }))),
    };
  });
  expect(result.problems).toEqual([]);
  expect(result.collection).toContain('prototype: "/exported/room/map.go"');
  expect(result.tilemap).toContain("x: 0\n    y: -1\n    tile: 0");
  expect(result.tilemap).toContain("x: 0\n    y: -2\n    tile: 7");
  expect(result.collision).toContain("position { x: 48 y: -48 z: 0 }");
  expect(result.collision).toContain("data: 16\n  data: 16\n  data: 0.5");
  expect(result.game.yUp).toBe(false);
  expect(result.repeated.written).toEqual([]);
  expect(result.repeated.unchanged).toEqual(result.first.written);
  // Retain a tiny official-Bob-buildable project as a reproducible test artifact.
  const projectRoot = testInfo.outputPath("defold-project");
  for (const file of result.files) {
    const path = join(projectRoot, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, new Uint8Array(file.bytes));
  }
  await writeFile(join(projectRoot, "game.project"), "[project]\ntitle = Defold export verification\n[bootstrap]\nmain_collection = /exported/room/map.collectionc\n[display]\nwidth = 64\nheight = 64\n[physics]\ntype = 2D\n[resource]\ncustom_resources = /exported/room/game.json\n");
  await mkdir(join(projectRoot, "input"), { recursive: true });
  await writeFile(join(projectRoot, "input/game.input_binding"), "");
  await writeFile(join(projectRoot, "probe.json"), JSON.stringify({ layerId: result.layerId }));
});

test("Defold preflight explains unsupported opacity before files are written", async ({ page }) => {
  await page.goto("/");
  await startWithTileset(page);
  const result = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { tilesetPngSource } = await import(/* @vite-ignore */ String("/src/state/tilesetImages.ts"));
    const { defoldTarget } = await import(/* @vite-ignore */ String("/src/export/targets/defold.ts"));
    const { t } = await import(/* @vite-ignore */ String("/src/i18n/index.ts"));
    const store = useEditorStore.getState().project.store;
    const layer = store.document.layers.find((layer: { type: string }) => layer.type === "tile");
    store.dispatch({ type: "setLayerProps", layerId: layer.id, props: { opacity: 0.5 } });
    const input = { doc: store.document, levelName: "room", bytes: tilesetPngSource };
    const problems = defoldTarget.preflight(input, {});
    let rejected = false;
    try { await defoldTarget.planFiles(input, {}); } catch { rejected = true; }
    return { messages: problems.map((problem: { key: string; params: object }) => t(problem.key, problem.params)), rejected };
  });
  expect(result.rejected).toBe(true);
  expect(result.messages.join(" ")).toContain("%100");
});
