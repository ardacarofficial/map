import type { Page } from "@playwright/test";
import { expect, readOpfsText, test } from "../support/fixtures";
import { acceptRoadStamp, cellPoint, dragRoad, makeRoadStamp } from "../support/smartStamp";

async function preview(page: Page) {
  return page.evaluate(() => {
    const hook = (window as unknown as { __smap: { smartPreview: { layers: { layerId: string; writes: unknown[] }[] } | null } }).__smap;
    return hook.smartPreview?.layers ?? [];
  });
}
async function matchesPreview(page: Page, layers: Awaited<ReturnType<typeof preview>>) {
  return page.evaluate(async layers => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const doc = useEditorStore.getState().project.store.document;
    for (const l of layers) for (const raw of l.writes) {
      const w = raw as { x: number; y: number; tile: { tilesetId: string; tileId: number } | null; flags?: number };
      const cell = doc.getLayer(l.layerId)?.getCell(w.x, w.y) ?? 0;
      if (!w.tile) { if (cell !== 0) return false; }
      else {
        const tile = doc.palette.get(cell & 0x1fffffff);
        if (tile?.tilesetId !== w.tile.tilesetId || tile?.tileId !== w.tile.tileId || ((cell & 0xe0000000) >>> 0) !== (w.flags ?? 0)) return false;
      }
    }
    return true;
  }, layers);
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const doc = useEditorStore.getState().project.store.document, layer = doc.layers.find((l: { type: string }) => l.type === "tile");
    return [...layer.chunks()].map(c => ({ key: c.key, cells: [...c.data] }));
  });
}

test("9 dilim: real bake previews, compact rectangles, shrinking, ghost equals commit, unmarked stamp regression", async ({ page }) => {
  await makeRoadStamp(page);
  await page.locator("[data-smart-brush]").click();
  await dragRoad(page, [[4, 4], [7, 4]]);
  const flat = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const store = useEditorStore.getState().project.store, layer = store.document.layers.find((l: { type: string }) => l.type === "tile");
    return [4,5,6,7,8,9].map(x=>store.document.palette.get(layer.getCell(x,4)&0x1fffffff)?.tileId);
  });
  expect(flat).toEqual([14,15,16,14,15,16]);
  await page.keyboard.press("Control+z");
  await page.locator("[data-smart-brush]").click();
  await page.keyboard.press("r");
  await expect(page.locator("[data-tool-option='rectangle']")).toHaveCount(1);
  for (const [x, y, w, h] of [[1, 1, 1, 1], [3, 1, 1, 4], [5, 1, 2, 2], [8, 1, 5, 4]]) {
    const a = await cellPoint(page, x!, y!), b = await cellPoint(page, x! + w! - 1, y! + h! - 1);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y);
    await expect.poll(async () => (await preview(page)).flatMap(l => l.writes).length).toBe(w! * h!);
    const ghost = await preview(page); await page.mouse.up();
    expect(await matchesPreview(page, ghost)).toBe(true);
  }
  await page.keyboard.press("b");
  await page.getByRole("radio", { name: "Alan", exact: true }).click();
  const a = await cellPoint(page, 3, 7), far = await cellPoint(page, 12, 10), small = await cellPoint(page, 5, 8);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(far.x, far.y); await page.mouse.move(small.x, small.y);
  await expect.poll(async () => (await preview(page)).flatMap(l => l.writes).length).toBe(6);
  const ghost = await preview(page); await page.mouse.up(); expect(await matchesPreview(page, ghost)).toBe(true);
  const before = await snapshot(page); await page.keyboard.press("Control+z"); await page.keyboard.press("Control+Shift+z"); expect(await snapshot(page)).toEqual(before);
});

test("9 dilim road: straight, L, T, +, joining strokes, transforms, erase, cancellation, save and reopen", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await makeRoadStamp(page); await acceptRoadStamp(page);
  await page.getByRole("radio", { name: "Yol", exact: true }).click();
  await expect(page.locator("[data-smart-stamp-mode]")).toHaveAttribute("data-smart-stamp-mode", "road");
  await dragRoad(page, [[2, 3], [8, 3]]); // straight
  await dragRoad(page, [[8, 3], [8, 7], [11, 7]]); // L, joins previous end
  await dragRoad(page, [[5, 1], [5, 6]]); // +
  await dragRoad(page, [[8, 5], [12, 5]]); // T
  // Filled R retains the authored corner slots even while the brush usage is Road.
  await page.keyboard.press("r"); await dragRoad(page, [[1, 9], [2, 10]]);
  const rectangleSlots = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const doc = useEditorStore.getState().project.store.document, layer = doc.layers.find((l: { type: string }) => l.type === "tile");
    return [[1, 9], [2, 9], [1, 10], [2, 10]].map(([x, y]) => doc.palette.get(layer.getCell(x, y) & 0x1fffffff)?.tileId);
  });
  expect(rectangleSlots).toEqual([0, 2, 6, 8]);
  await page.keyboard.press("b");
  await page.keyboard.press("x");
  const next = await cellPoint(page, 12, 7); await page.mouse.move(next.x, next.y);
  await expect.poll(async () => (await preview(page)).flatMap(l => l.writes).length).toBeGreaterThan(0);
  const ghost = await preview(page); await page.mouse.down(); await page.mouse.up(); expect(await matchesPreview(page, ghost)).toBe(true);
  const before = await snapshot(page); await page.keyboard.press("Control+z"); expect(await snapshot(page)).not.toEqual(before); await page.keyboard.press("Control+Shift+z"); expect(await snapshot(page)).toEqual(before);
  // A line from the previous endpoint uses the same bridge/preview as its commit.
  const at = await cellPoint(page, 14, 9); await page.mouse.move(at.x, at.y);
  await expect.poll(async () => (await preview(page)).flatMap(l => l.writes).length).toBeGreaterThan(0);
  const pointCount = (await preview(page)).flatMap(l => l.writes).length;
  await page.keyboard.down("Shift");
  await expect.poll(async () => (await preview(page)).flatMap(l => l.writes).length).toBeGreaterThan(pointCount);
  await expect.poll(async () => (await preview(page)).flatMap(l => l.writes).length).toBeGreaterThan(0);
  const line = await preview(page); await page.mouse.down(); await page.mouse.up(); await page.keyboard.up("Shift"); expect(await matchesPreview(page, line)).toBe(true);
  await page.keyboard.press("e"); const erase = await cellPoint(page, 5, 3); await page.mouse.move(erase.x, erase.y);
  await expect.poll(async () => (await preview(page)).flatMap(l => l.writes).length).toBeGreaterThan(0);
  const erasure = await preview(page); await page.mouse.down(); await page.mouse.up(); expect(await matchesPreview(page, erasure)).toBe(true);
  await page.keyboard.press("b"); const cancelBefore = await snapshot(page);
  await page.mouse.move(at.x, at.y); await page.mouse.down(); const off = await cellPoint(page, 15, 10); await page.mouse.move(off.x, off.y); await page.keyboard.press("Escape"); await page.mouse.up(); expect(await snapshot(page)).toEqual(cancelBefore);
  // pointercancel rolls the active road transaction back.
  await page.mouse.move(off.x, off.y); await page.mouse.down();
  const farther = await cellPoint(page, 16, 10); await page.mouse.move(farther.x, farther.y);
  await page.locator("canvas[aria-label='map canvas']").first().dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up(); expect(await snapshot(page)).toEqual(cancelBefore);
  await page.mouse.move(10, 10); await page.keyboard.press("Control+s");
  // Autosave can replace the file between an existence check and a second read.
  await expect.poll(async () => {
    const text = await readOpfsText(page, "project.smap");
    if (!text) return false;
    const project = JSON.parse(text);
    return project.tilesets.some((t: { generated?: unknown; imagePath: string }) => t.generated && t.imagePath.startsWith("tilesets/"));
  }).toBe(true);
  await expect.poll(() => page.evaluate(async () => { const { useUiStore } = await import(/* @vite-ignore */ String("/src/ui/uiStore.ts")); return useUiStore.getState().busy; })).toBe(false);
  const saved = await snapshot(page); await page.reload(); await page.getByRole("button", { name: /^Aç…/ }).click();
  await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();
  expect(await snapshot(page)).toEqual(saved);
  await page.locator("[data-panel-tab='stamps']").click();
  await page.locator("[data-stamp-id='koy-yolu']").dblclick();
  await expect(page.locator("[data-smart-stamp-mode]")).toBeVisible();
  expect(errors).toEqual([]);
});

test("generated bank: deterministic PNG reload, stable slots, Save As and unmark keeps used atlas", async ({ page }) => {
  await makeRoadStamp(page); await acceptRoadStamp(page);
  await page.getByRole("radio", { name: "Yol", exact: true }).click(); await dragRoad(page, [[2, 3], [7, 3]]);
  await page.keyboard.press("Control+s"); await expect.poll(() => readOpfsText(page, "project.smap")).not.toBeNull();
  await expect.poll(() => page.evaluate(async () => {
    const { useUiStore } = await import(/* @vite-ignore */ String("/src/ui/uiStore.ts"));
    return useUiStore.getState().busy;
  })).toBe(false);
  const result = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { useProjectLibrary } = await import(/* @vite-ignore */ String("/src/io/projectLibrary.ts"));
    const commands = await import(/* @vite-ignore */ String("/src/commands/smartStampCommands.ts"));
    const { getTilesetImage, tilesetImageBytes } = await import(/* @vite-ignore */ String("/src/state/tilesetImages.ts"));
    const { reloadTilesetImage } = await import(/* @vite-ignore */ String("/src/platform/fileChanges.ts"));
    const { getProjectFolder, saveCurrentProject } = await import(/* @vite-ignore */ String("/src/io/session.ts"));
    const store = useEditorStore.getState().project.store, lib = useProjectLibrary.getState(), stamp = lib.stamps[0];
    const original = store.document.tilesets.find((t: { generated?: unknown }) => t.generated), oldBytes = [...getTilesetImage(original.id).bytes];
    const unchanged = await commands.prepareSmartStamp(stamp);
    const samePng = JSON.stringify([...await tilesetImageBytes(unchanged.assets[0].image)]) === JSON.stringify(oldBytes);
    commands.discardSmartStamp(unchanged);
    const source = store.document.getTileset("road-source"), image = getTilesetImage(source.id);
    const canvas = new OffscreenCanvas(image.bitmap.width, image.bitmap.height), ctx = canvas.getContext("2d")!;
    ctx.drawImage(image.bitmap, 0, 0); ctx.fillStyle = "#b8ae82"; ctx.fillRect(96, 64, 32, 32);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    await getProjectFolder().fs.writeBytes(source.imagePath, bytes);
    await reloadTilesetImage(source.imagePath); await commands.waitForSmartStampRegeneration();
    const updated = store.document.getTileset(original.id), changedBytes = await tilesetImageBytes(getTilesetImage(original.id));
    const changed = JSON.stringify([...changedBytes]) !== JSON.stringify(oldBytes);
    const sourceKept = JSON.stringify([...getTilesetImage(source.id).bytes]) === JSON.stringify([...bytes]);
    const cells = [...store.document.layers.find((l: { type: string }) => l.type === "tile").chunks()].map(c => [...c.data]);
    commands.disableSmartStamp(stamp.id);
    const retained = !!store.document.getTileset(original.id), flat = !!useProjectLibrary.getState().stamps[0].smartDisabled;
    const unchangedCells = JSON.stringify([...store.document.layers.find((l: { type: string }) => l.type === "tile").chunks()].map(c => [...c.data])) === JSON.stringify(cells);
    useProjectLibrary.getState().removeStamp(stamp.id);
    const copy = await (await navigator.storage.getDirectory()).getDirectoryHandle("saved-copy", { create: true });
    (window as unknown as { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => copy;
    const savedAs = await saveCurrentProject(true);
    return { savedAs, samePng, changed, sourceKept, retained, flat, unchangedCells, original: { id: original.id, path: original.imagePath, columns: original.columns, rows: original.rows }, updated: { id: updated.id, path: updated.imagePath, columns: updated.columns, rows: updated.rows } };
  });
  expect(result).toMatchObject({ savedAs: true, samePng: true, changed: true, sourceKept: true, retained: true, flat: true, unchangedCells: true });
  expect(result.updated).toEqual(result.original);
  await page.reload();
  await page.evaluate(() => {
    (window as unknown as { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("saved-copy");
  });
  await page.getByRole("button", { name: /^Aç…/ }).click(); await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();
  const provenance = await page.evaluate(async () => {
    const { useProjectLibrary } = await import(/* @vite-ignore */ String("/src/io/projectLibrary.ts"));
    return { stamps: useProjectLibrary.getState().stamps.length, recipes: useProjectLibrary.getState().generatedRecipes.length };
  });
  expect(provenance).toEqual({ stamps: 0, recipes: 1 });
});

test("multi-layer smart stamp: area skips hidden layers and retains area-only behavior", async ({ page }) => {
  await makeRoadStamp(page);
  await page.evaluate(async () => {
    const { useProjectLibrary } = await import(/* @vite-ignore */ String("/src/io/projectLibrary.ts"));
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const stamp = useProjectLibrary.getState().stamps[0], store = useEditorStore.getState().project.store;
    const id = store.dispatch({ type: "addLayer", layer: { name: "Overlay" } });
    store.dispatch({ type: "setLayerProps", layerId: id, props: { visible: false } });
    const { prepareSmartStamp, acceptSmartStamp } = await import(/* @vite-ignore */ String("/src/commands/smartStampCommands.ts"));
    const { pickStamp } = await import(/* @vite-ignore */ String("/src/commands/stampActions.ts"));
    const { nineSlice: _old, ...flat } = stamp;
    const multi = { ...flat, layers: [...stamp.layers, { ...stamp.layers[0], layerId: "overlay-source", name: "Overlay" }] };
    useProjectLibrary.getState().addStamp(multi);
    acceptSmartStamp(await prepareSmartStamp(multi)); pickStamp(multi.id);
  });
  await expect(page.locator("[data-smart-stamp-mode]")).toHaveAttribute("data-smart-stamp-mode", "area"); await dragRoad(page, [[2, 2], [4, 4]]);
  const overlayEmpty = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    return [...useEditorStore.getState().project.store.document.layers.find((l: { name: string }) => l.name === "Overlay").chunks()].length === 0;
  });
  expect(overlayEmpty).toBe(true);
  await expect(page.getByRole("radio", { name: "Yol", exact: true })).toBeDisabled();
});

test("options bar owns the single smart switch; Inspector only shows source facts", async ({ page }) => {
  await makeRoadStamp(page);
  await page.setViewportSize({width:1366,height:768});
  const toggle=page.locator("[data-smart-brush]");await expect(toggle).toHaveCount(1);await expect(toggle).toBeChecked();
  await expect(page.getByRole("switch",{name:"9 dilim",exact:true})).toHaveCount(0);
  await toggle.focus();await page.keyboard.press("Space");await expect(toggle).not.toBeChecked();await expect(page.locator("[data-smart-stamp-dialog]")).toBeHidden();
  await toggle.click();await expect(toggle).toBeChecked();
});
