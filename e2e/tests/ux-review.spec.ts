import type { EditorState } from "../../packages/editor/src/state/editorStore";
import type { MapStore } from "../../packages/core/src";
import type { Page } from "@playwright/test";

import { confirmTilesetCard, dropFile, expect, sampleBytes, test } from "../support/fixtures";

type Hook = {
  editor: { getState(): EditorState };
  store: MapStore;
  cellCenter(x: number, y: number): { x: number; y: number };
};

async function openMap(page: Page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await dropFile(page, "body", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();
}

/** Recover map bounds and the map point at canvas centre using the existing debug hook. */
async function view(page: Page) {
  return page.evaluate(() => {
    const h = (window as unknown as { __smap: Hook }).__smap;
    const canvas = document.querySelector("canvas[aria-label='map canvas']")!.getBoundingClientRect();
    const a = h.cellCenter(0, 0);
    const b = h.cellCenter(1, 1);
    const tile = b.x - a.x;
    const left = a.x - tile / 2;
    const top = a.y - tile / 2;
    return {
      zoom: h.editor.getState().zoom,
      cx: (canvas.x + canvas.width / 2 - left) / tile,
      cy: (canvas.y + canvas.height / 2 - top) / tile,
      fits: left >= canvas.left && top >= canvas.top && left + tile * 64 <= canvas.right && top + tile * 48 <= canvas.bottom,
    };
  });
}

test("1366×768: opening frames the whole map; Tab in both directions keeps zoom and centre", async ({ page }) => {
  await openMap(page);
  await expect.poll(async () => (await view(page)).fits).toBe(true);
  const before = await view(page);
  expect(before.zoom).toBeLessThan(0.5);
  expect(before.cx).toBeCloseTo(32);
  expect(before.cy).toBeCloseTo(24);
  const canvas = page.locator("canvas[aria-label='map canvas']").first();
  await canvas.focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-tileset-side]")).toBeHidden();
  await expect.poll(async () => (await view(page)).zoom).toBe(before.zoom);
  await expect.poll(async () => (await view(page)).cx).toBeCloseTo(before.cx);
  await expect.poll(async () => (await view(page)).cy).toBeCloseTo(before.cy);
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-tileset-side]")).toBeVisible();
  await expect.poll(async () => (await view(page)).zoom).toBe(before.zoom);
  await expect.poll(async () => (await view(page)).cx).toBeCloseTo(before.cx);
  await expect.poll(async () => (await view(page)).cy).toBeCloseTo(before.cy);
});

test("a multi-tile tileset brush is paint in history; hidden layers block the next stroke", async ({ page }) => {
  await openMap(page);
  const grid = page.locator("[data-tileset-grid='overworld-32']");
  const box = (await grid.boundingBox())!;
  const scale = Number(await grid.getAttribute("data-tileset-scale"));
  const size = 32 * scale;
  await page.mouse.move(box.x + size / 2, box.y + size / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + size * 2.5, box.y + size * 1.5, { steps: 8 });
  await page.mouse.up();
  const point = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.cellCenter(32, 24));
  await page.mouse.click(point.x, point.y);
  await page.getByRole("tab", { name: "Geçmiş", exact: true }).click();
  await expect(page.locator("[data-history-row]").last()).toContainText(/Boya \d+ hücre/);
  await page.evaluate(() => {
    const h = (window as unknown as { __smap: Hook }).__smap;
    h.store.dispatch({ type: "setLayerProps", layerId: h.editor.getState().activeLayerId!, props: { visible: false } });
  });
  const before = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.undoDepth);
  await page.mouse.click(point.x + 40, point.y);
  await expect(page.locator("[data-toaster]")).toContainText("katmanı gizli");
  expect(await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.undoDepth)).toBe(before);
});

test("F6 follows physical groups, restores panels, expands rails and stays inside modals", async ({ page }) => {
  await openMap(page);
  const host = page.locator("[data-canvas-host]");
  await host.focus();
  for (const target of ["[data-tileset-viewport]", "[data-panel-tab=inspector]", "[data-layers-list]", "[data-panel-tab=recent]", "[data-canvas-host]"]) {
    await page.keyboard.press("F6");
    await expect(page.locator(target).first()).toBeFocused();
  }
  await expect(host).toHaveAttribute("data-focus-inset", "");
  await page.keyboard.press("Shift+F6");
  await expect(page.locator("[data-panel-tab=recent]")).toBeFocused();
  await host.focus(); await page.keyboard.press("Tab");
  await expect(page.locator("[data-tileset-viewport]")).toBeHidden();
  await page.keyboard.press("F6");
  await expect(page.locator("[data-tileset-viewport]")).toBeFocused();
  await page.keyboard.press("Control+b");
  await host.focus(); await page.keyboard.press("F6");
  await expect(page.locator("[data-tileset-viewport]")).toBeFocused();
  await expect(page.locator("[data-dock-zone=left]")).toHaveAttribute("data-zone-state", "expanded");
  await page.keyboard.press("Control+k");
  const input = page.getByRole("dialog").getByRole("combobox");
  await expect(input).toBeFocused(); await page.keyboard.press("F6"); await expect(input).toBeFocused();
  await input.fill("Sonraki bölgeye geç");
  await expect(page.getByRole("dialog")).toContainText("F6");
});

test("1366×768: Fit shows the whole 256px tileset in its left panel", async ({ page }) => {
  await openMap(page);
  await page.locator("[data-tileset-zoom-fit]").click();
  // The source viewport keeps scrollable panning space even after Fit and uses continuous zoom.
  // Check the visible sheet rather than the virtual scroll area or a legacy discrete zoom step.
  const geometry = () => page.locator("[data-tileset-viewport]").evaluate(el => {
    const viewport = el.getBoundingClientRect();
    const sheet = el.querySelector<HTMLElement>("[data-tileset-grid]")!.getBoundingClientRect();
    return {
      fits: sheet.left >= viewport.left - 1 && sheet.top >= viewport.top - 1
        && sheet.right <= viewport.left + el.clientWidth + 1 && sheet.bottom <= viewport.top + el.clientHeight + 1,
      fill: Math.max(sheet.width / el.clientWidth, sheet.height / el.clientHeight),
    };
  });
  await expect.poll(async () => (await geometry()).fits).toBe(true);
  expect((await geometry()).fill).toBeGreaterThan(0.9);
});

test("right split preserves its ratio while layer list keys select and reveal rows", async ({ page }) => {
  await openMap(page);
  await page.evaluate(() => {
    const h = (window as unknown as { __smap: Hook }).__smap;
    while (h.store.document.layers.length < 12) h.store.dispatch({ type: "addLayer", layer: { name: `Layer ${h.store.document.layers.length}` } });
    h.editor.getState().setSelection(null);
    h.editor.getState().setStamp(null);
    h.editor.getState().setTool("brush");
  });
  await expect(page.locator("[data-inspector-title]")).toContainText("Önce bir tile seç");
  await expect.poll(() => page.locator("[data-right-column]").evaluate(el => el.querySelector("[data-section=layers]")!.getBoundingClientRect().height / el.getBoundingClientRect().height)).toBeGreaterThan(0.3);
  const list = page.locator("[data-layers-list]");
  const rows = list.getByRole("option");
  await list.focus();
  await page.keyboard.press("Home");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(rows.last()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(rows.nth(10)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(rows.last()).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => rows.last().evaluate(el => { const row = el.getBoundingClientRect(); const parent = el.parentElement!.getBoundingClientRect(); return row.top >= parent.top - 1 && row.bottom <= parent.bottom + 1; })).toBe(true);
  await page.keyboard.press("Enter");
  await expect(list.getByRole("textbox")).toBeFocused();
  await page.keyboard.press("Escape");
  const splitter = page.locator("[data-section-splitter]");
  await splitter.focus();
  await splitter.press("Shift+ArrowDown");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("smap.layout.v2")!).zones.right.groups[0].weight)).toBeGreaterThan(0.6);
});

test("new project validates immediately and retains its preview without shifting on errors", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+n");
  const dialog = page.locator("[data-dialog=new-project]");
  const preview = dialog.getByLabel("Önizleme", { exact: true });
  const summary = (await preview.textContent())!;
  const before = (await dialog.boundingBox())!.height;
  await dialog.getByRole("textbox", { name: "Genişlik", exact: true }).fill("0");
  await expect(dialog.getByRole("button", { name: "Oluştur", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("textbox", { name: "Genişlik", exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(preview).toHaveText(summary);
  expect((await dialog.boundingBox())!.height).toBe(before);
  await dialog.getByRole("textbox", { name: "Genişlik", exact: true }).fill("64");
  await expect(dialog.getByRole("button", { name: "Oluştur", exact: true })).toBeEnabled();
});

test("corrupt PNG reports its decode error inside the new-project dialog without covering Create", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+n");
  await expect(page.locator("[data-dialog=new-project]")).toBeVisible();
  await dropFile(page, "[data-dialog=new-project] form", "broken.png", [1, 2, 3]);
  await expect(page.locator("[data-toaster]")).toContainText("Görsel okunamadı: broken.png");
  const dialog = page.locator("[data-dialog=new-project]");
  await expect(dialog.locator("[data-modal-feedback]")).toBeVisible();
  expect(await dialog.locator("[data-modal-feedback]").evaluate(el => !!el.closest("footer"))).toBe(true);
  const create = dialog.getByRole("button", { name: "Oluştur", exact: true });
  expect(await create.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === el || el.contains(hit);
  })).toBe(true);
  await dropFile(page, "[data-dialog=new-project] form", "wrong.jpg", [1, 2, 3], "image/jpeg");
  await expect(page.locator("[data-toaster]")).toContainText("Yalnızca PNG tileset eklenebilir: wrong.jpg");
});

test("empty marquee cannot save a stamp; arming a saved stamp removes its stale toast action", async ({ page }) => {
  await openMap(page);
  await page.evaluate(() => {
    const state = (window as unknown as { __smap: Hook }).__smap.editor.getState();
    state.setTool("select");
    state.setRegion({ x: 32, y: 24, width: 2, height: 2 });
  });
  await expect(page.locator("[data-action='stamp.saveSelection']")).toHaveAttribute("aria-disabled", "true");
  const point = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.cellCenter(32, 24));
  await page.mouse.click(point.x, point.y, { button: "right" });
  const saveItem = page.locator("[data-context-item=makeStamp]");
  await expect(saveItem).toHaveAttribute("aria-disabled", "true");
  await expect(saveItem).toHaveAttribute("title", "Seçili alan boş");
  expect(await saveItem.evaluate(el => getComputedStyle(el).pointerEvents)).toBe("auto");
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const { useUiStore } = await import(/* @vite-ignore */ String("/src/ui/uiStore.ts"));
    useUiStore.getState().setSaveStampOpen(true);
  });
  await expect(page.getByRole("dialog")).toContainText("Seçili alan boş");
  const stampName = page.getByRole("dialog").getByRole("textbox");
  await expect(stampName).toBeFocused();
  await page.keyboard.press("F6");
  await expect(stampName).toBeFocused();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Kaydet", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const h = (window as unknown as { __smap: Hook }).__smap;
    const layerId = h.editor.getState().activeLayerId!;
    const cell = h.store.getOrAddPaletteIndex(h.store.document.tilesets[0]!.id, 1);
    h.store.dispatch({ type: "paintCells", layerId, cells: [{ x: 32, y: 24, cell }] });
    const actions = await import(/* @vite-ignore */ String("/src/commands/stampActions.ts"));
    const saved = actions.saveSelectionAsStamp("Toast stamp");
    if (!saved) throw new Error("Expected a nonempty stamp");
  });
  await expect(page.locator("[data-toaster]")).toContainText("Fırçaya al");
  await page.evaluate(async () => {
    const actions = await import(/* @vite-ignore */ String("/src/commands/stampActions.ts"));
    const { useProjectLibrary } = await import(/* @vite-ignore */ String("/src/io/projectLibrary.ts"));
    const { useStampLibrary } = await import(/* @vite-ignore */ String("/src/ui/stamps/stampLibraryStore.ts"));
    const stamp = useProjectLibrary.getState().stamps[0];
    actions.pickStamp(stamp.id);
    useStampLibrary.getState().select(stamp.id);
  });
  await expect(page.locator("[data-toaster]")).toBeHidden();
  await expect(page.locator("[data-action=placeStamp]")).toBeDisabled();
  await expect(page.locator("[data-action=placeStamp]")).toHaveText("Fırçada etkin");
});

test("group splitter reset restores the default ratio across reload even when brush content clears", async ({ page }) => {
  await openMap(page);
  await page.evaluate(() => {
    const h = (window as unknown as { __smap: Hook }).__smap;
    h.editor.getState().setSelection({ tilesetId: h.store.document.tilesets[0]!.id, tileId: 4 });
  });
  await expect(page.locator("[data-inspector-title]")).toContainText("Tile #4");
  const layers = page.locator("[data-section='layers']");
  const initial = (await layers.boundingBox())!.height;
  const splitter = page.locator("[data-section-splitter]");
  const box = (await splitter.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 150, { steps: 8 });
  await page.mouse.up();
  const dragged = (await layers.boundingBox())!.height;
  expect(dragged).toBeGreaterThan(initial + 100);
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.editor.getState().dirty)).toBe(false);
  await page.reload();
  await page.getByRole("button", { name: /^Aç…/ }).first().click();
  await expect(page.locator("[data-inspector-title]")).toContainText("Önce bir tile seç");
  await expect.poll(async () => (await layers.boundingBox())!.height).toBe(dragged);
  await splitter.dblclick();
  await expect.poll(async () => (await layers.boundingBox())!.height).toBe(initial);
});

test("zoom field reports the requested preset while a slow camera frame is still interpolating", async ({ page }) => {
  await openMap(page);
  await page.clock.install({ time: new Date("2026-10-18T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-18T12:00:01Z"));
  await page.evaluate(async () => {
    const { getCanvasHandle } = await import(/* @vite-ignore */ String("/src/ui/canvas/canvasHandle.ts"));
    getCanvasHandle().setZoom(1);
  });
  await page.clock.runFor(32);
  expect((await view(page)).zoom).toBe(1);
  const actualTileWidth = () => page.evaluate(() => {
    const h = (window as unknown as { __smap: Hook }).__smap;
    return h.cellCenter(1, 0).x - h.cellCenter(0, 0).x;
  });
  expect(await actualTileWidth()).toBeLessThan(32);
  await page.clock.runFor(500);
  expect(await actualTileWidth()).toBe(32);
});
