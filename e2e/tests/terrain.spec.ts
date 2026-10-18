import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Locator, Page } from "@playwright/test";

import { confirmTilesetCard, dropFile, expect, sampleBytes, test } from "../support/fixtures";

/** Screens for the review go next to the other round-4 shots (outside the repo). */
const OUT = process.env.SMAP_SHOTS ?? fileURLToPath(new URL("../test-results/r4terrain/", import.meta.url));
mkdirSync(OUT, { recursive: true });

type Hook = {
  editor: {
    getState(): {
      tool: string;
      brushSize: number;
      terrainActive: boolean;
      terrain: { tilesetId: string; setId: string; terrainId: number } | null;
      activeLayerId: string | null;
    };
  };
  store: {
    document: {
      layers: { id: string; type: string; getCell(x: number, y: number): number }[];
      palette: { get(i: number): { tilesetId: string; tileId: number } | undefined };
      tilesets: { id: string; terrainSets?: { id: string; name: string; kind: string; terrains: { id: number; name: string }[]; tiles: unknown[]; background?: number }[] }[];
    };
    getOrAddPaletteIndex(tilesetId: string, tileId: number): number;
    dispatch(op: unknown): unknown;
    clearHistory(): void;
  };
  cellCenter(x: number, y: number): { x: number; y: number } | null;
};

/** Tile id at (x, y) of the active tile layer (null = empty). */
const tileAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]) => {
      const h = (window as unknown as { __smap: Hook }).__smap;
      const id = h.editor.getState().activeLayerId;
      const layer = h.store.document.layers.find((l) => l.id === id)!;
      const cell = layer.getCell(x!, y!);
      return cell === 0 ? null : h.store.document.palette.get(cell & 0x1fffffff)!.tileId;
    },
    [x, y],
  );

const editorState = (page: Page) => page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.editor.getState());

const terrainSets = (page: Page) =>
  page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.document.tilesets[0]!.terrainSets ?? []);

async function cellPoint(page: Page, x: number, y: number) {
  return (await page.evaluate(([x, y]) => (window as unknown as { __smap: Hook }).__smap.cellCenter(x!, y!), [x, y]))!;
}

/** Page position inside tileset cell (col, row); `fx`, `fy` = fraction inside the tile. */
async function tilesetCell(image: Locator, col: number, row: number, fx = 0.5, fy = 0.5) {
  const box = (await image.boundingBox())!;
  const scale = Number(await image.getAttribute("data-tileset-scale"));
  const size = 32 * scale;
  return { x: box.x + (col + fx) * size, y: box.y + (row + fy) * size };
}

async function openProject(page: Page, file: string) {
  await page.goto("/");
  await expect(page.getByText("Tileset bırak")).toBeVisible();
  await dropFile(page, "body", file, sampleBytes(`tilesets/${file}`));
  await confirmTilesetCard(page);
  await expect(page.locator("canvas[aria-label='map canvas']").first()).toBeVisible();
  const image = page.locator("[data-tileset-grid]").first();
  await expect(image).toBeVisible();
  // Zoom the map so cells are easy to hit.
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("Shift+Digit1");
  await page.waitForTimeout(300);
  return image;
}

/** Arazi mode, then a rough drag from (c0, r0) to (c1, r1). */
async function roughSelect(page: Page, image: Locator, c0: number, r0: number, c1: number, r1: number) {
  await page.locator("[data-tileset-mode='terrain']").click();
  const a = await tilesetCell(image, c0, r0);
  const b = await tilesetCell(image, c1, r1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await expect(page.locator("[data-terrain-rough]")).toBeVisible();
  await page.mouse.up();
}

async function pickOption(page: Page, trigger: string, value: string) {
  await page.locator(trigger).click();
  await page.locator(`[data-select-option="${value}"]`).click();
}

test("blob47-godot: rough rectangle → template found, define, paint next to a manual tile, erase, undo", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  const image = await openProject(page, "blob47-godot-32.png");

  // A manual (untagged) tile on the layer: the blank cell (10, 1) = tile 22.
  await page.evaluate(() => {
    const h = (window as unknown as { __smap: Hook }).__smap;
    const layerId = h.editor.getState().activeLayerId!;
    const ts = h.store.document.tilesets[0]!.id;
    h.store.dispatch({ type: "paintCells", layerId, cells: [{ x: 8, y: 5, cell: h.store.getOrAddPaletteIndex(ts, 22) }] });
    h.store.clearHistory();
  });

  // A library stamp must yield to terrain editing without stacking a card.
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { saveSelectionAsStamp } = await import(/* @vite-ignore */ String("/src/commands/stampActions.ts"));
    useEditorStore.getState().setTool("select");
    useEditorStore.getState().setRegion({ x: 8, y: 5, width: 1, height: 1 });
    saveSelectionAsStamp("Library stamp");
  });
  await page.locator("[data-stamp-library] [data-stamp-id]").click();
  await expect(page.locator("[data-stamp-inspector]")).toBeVisible();

  // ---- Define: a sloppy drag over part of the block is enough.
  await roughSelect(page, image, 2, 1, 9, 2);
  const candidate = page.locator("[data-terrain-candidate]");
  await expect(candidate).toHaveAttribute("data-terrain-candidate", "blob47-godot");
  await expect(candidate).toHaveAttribute("data-terrain-origin", "0,0");
  const card = page.locator("[data-inspector-terrain='define']");
  await expect(card).toBeVisible();
  await expect(card.locator("[data-terrain-preview]")).toHaveAttribute("data-terrain-preview-missing", "0");
  await expect(page.locator("[data-stamp-inspector]")).toHaveCount(0);
  await expect(page.locator("[data-inspector-section]")).toHaveCount(1);
  const defineButton = card.locator("[data-action='terrain-define']");
  expect(await defineButton.evaluate((el) => {
    const inspector = el.closest("[data-inspector]")!;
    const button = el.getBoundingClientRect();
    const viewport = inspector.getBoundingClientRect();
    return inspector.scrollTop === 0 && button.top >= viewport.top && button.bottom <= viewport.bottom;
  })).toBe(true);
  await expect(card.locator("[data-terrain-name-input]")).toBeFocused();
  await page.keyboard.type("Çimen");
  await expect(card.locator("[data-terrain-name-input]")).toHaveValue("Çimen");
  await page.screenshot({ path: `${OUT}01-blob-define.png` });
  await card.locator("[data-action='terrain-define']").click();

  await expect(page.locator("[data-tool-option='terrain'] [data-terrain-current]")).toHaveAttribute("data-terrain-current", "Çimen");
  const sets = await terrainSets(page);
  expect(sets).toHaveLength(1);
  await expect(page.locator("[data-terrain-set-heading]")).toHaveCount(0);
  expect(sets[0]!.kind).toBe("blob");
  expect(sets[0]!.tiles).toHaveLength(47);
  let s = await editorState(page);
  expect(s.terrainActive).toBe(true);
  expect(s.tool).toBe("brush");
  expect(s.brushSize).toBe(3);
  await expect(page.locator("[data-tool-option='terrain'] [data-terrain-current]")).toHaveAttribute("data-terrain-current", "Çimen");
  await expect(page.locator("[data-inspector-terrain='Çimen']")).toBeVisible();

  // ---- Paint a stroke (3 × 3 brush) right next to the manual tile.
  const a = await cellPoint(page, 4, 4);
  const b = await cellPoint(page, 6, 4);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  // Interior cells get the fully surrounded tile (mask 255 = cell (9, 2) = tile 33).
  await expect.poll(() => tileAt(page, 5, 4)).toBe(33);
  expect(await tileAt(page, 3, 4)).not.toBeNull();
  expect(await tileAt(page, 8, 5)).toBe(22); // manual tile kept
  expect(await tileAt(page, 9, 4)).toBeNull();
  // Hover preview: the ghost of what a click would write.
  const hover = await cellPoint(page, 10, 8);
  await page.mouse.move(hover.x, hover.y);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}02-blob-painted.png` });

  // ---- Eraser (terrain eraser, same size): the middle goes, the edges re-solve.
  await page.keyboard.press("e");
  const mid = await cellPoint(page, 5, 4);
  await page.mouse.click(mid.x, mid.y);
  await expect.poll(() => tileAt(page, 5, 4)).toBeNull();
  expect(await tileAt(page, 8, 5)).toBe(22);
  expect(await tileAt(page, 3, 4)).not.toBeNull();

  // ---- Undo: eraser, then the stroke.
  await page.keyboard.press("Control+z");
  await expect.poll(() => tileAt(page, 5, 4)).toBe(33);
  await page.keyboard.press("Control+z");
  await expect.poll(() => tileAt(page, 5, 4)).toBeNull();
  expect(await tileAt(page, 3, 4)).toBeNull();
  expect(await tileAt(page, 8, 5)).toBe(22);

  // ---- A tile pick turns the terrain brush off; Autotile brings it back.
  const tile = await tilesetCell(image, 0, 3);
  // "Tanımla" already left ⚙ Düzenle: a click picks a tile again.
  await expect(page.locator("[data-tileset-mode='pick']")).toHaveAttribute("aria-checked", "true");
  await page.mouse.click(tile.x, tile.y);
  s = await editorState(page);
  expect(s.terrainActive).toBe(false);
  expect(s.brushSize).toBe(1);
  await page.locator("[data-tool-autotile]").check();
  expect((await editorState(page)).terrainActive).toBe(true);

  expect(errors).toEqual([]);
});

test("wang16 corner set with two terrains: transitions, rectangle, right-click picks the terrain", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const image = await openProject(page, "wang16-32.png");

  // ---- "Toprak" from the block (no background) ...
  await roughSelect(page, image, 0, 0, 3, 3);
  await expect(page.locator("[data-terrain-candidate]")).toHaveAttribute("data-terrain-candidate", "corner16");
  let card = page.locator("[data-inspector-terrain='define']");
  await card.locator("[data-terrain-name-input]").fill("Toprak");
  await card.locator("[data-action='terrain-define']").click();
  await expect(page.locator("[data-tool-option='terrain'] [data-terrain-current]")).toHaveAttribute("data-terrain-current", "Toprak");
  const setId = (await terrainSets(page))[0]!.id;

  // ---- ... then "Çimen" from the same block in the same set, over Toprak (the transitions).
  await roughSelect(page, image, 1, 1, 2, 2);
  card = page.locator("[data-inspector-terrain='define']");
  await expect(card).toBeVisible();
  await pickOption(page, "[data-terrain-target-set]", setId);
  await pickOption(page, "[data-terrain-background]", "1");
  await card.locator("[data-terrain-name-input]").fill("Çimen");
  await page.screenshot({ path: `${OUT}03-corner-define-second.png` });
  await card.locator("[data-action='terrain-define']").click();
  await expect(page.locator("[data-tool-option='terrain'] [data-terrain-current]")).toHaveAttribute("data-terrain-current", "Çimen");
  const sets = await terrainSets(page);
  expect(sets).toHaveLength(1);
  await expect(page.locator("[data-terrain-set-heading]")).toHaveCount(0);
  expect(sets[0]!.terrains.map((t) => t.name)).toEqual(["Toprak", "Çimen"]);
  expect(sets[0]!.background).toBe(1);

  // ---- Toprak everywhere in a rectangle (tile 0 = all dirt).
  await page.locator("[data-terrain-current]").click();
  await page.locator("[data-terrain-option='Toprak']").click();
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("r");
  const r0 = await cellPoint(page, 1, 1);
  const r1 = await cellPoint(page, 10, 8);
  await page.mouse.move(r0.x, r0.y);
  await page.mouse.down();
  await page.mouse.move(r1.x, r1.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => tileAt(page, 5, 4)).toBe(0);
  expect(await tileAt(page, 1, 1)).toBe(0);

  // ---- Çimen with the 3 × 3 brush: grass inside, transition tiles around, dirt beyond.
  await page.locator("[data-terrain-current]").click();
  await page.locator("[data-terrain-option='Çimen']").click();
  await page.keyboard.press("b");
  expect((await editorState(page)).brushSize).toBe(3);
  const c = await cellPoint(page, 5, 4);
  await page.mouse.click(c.x, c.y);
  await expect.poll(() => tileAt(page, 5, 4)).toBe(15);
  expect(await tileAt(page, 3, 4)).toBe(3); // NE + SE grass
  expect(await tileAt(page, 7, 4)).toBe(12); // SW + NW grass
  expect(await tileAt(page, 3, 2)).toBe(2); // SE only
  expect(await tileAt(page, 1, 1)).toBe(0);
  await page.mouse.move(c.x + 200, c.y + 120);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}04-corner-painted.png` });

  // ---- Right click on a tagged tile picks its terrain.
  const dirt = await cellPoint(page, 1, 1);
  await page.mouse.click(dirt.x, dirt.y, { button: "right" });
  await expect.poll(async () => (await editorState(page)).terrain?.terrainId).toBe(1);
  expect((await editorState(page)).terrainActive).toBe(true);
  const grass = await cellPoint(page, 5, 4);
  await page.mouse.click(grass.x, grass.y, { button: "right" });
  await expect.poll(async () => (await editorState(page)).terrain?.terrainId).toBe(2);

  // ---- Undo the brush: back to all dirt.
  await page.keyboard.press("Control+z");
  await expect.poll(() => tileAt(page, 5, 4)).toBe(0);
  expect(await tileAt(page, 3, 4)).toBe(0);

  // ---- Düzelt shows the tags; a corner click retags one tile (undoable).
  await page.locator("[data-tileset-mode='terrain']").click();
  await page.locator("[data-action='terrain-fix']").click();
  await expect(page.locator("[data-inspector-terrain='fix']")).toBeVisible();
  await expect(page.locator(`[data-terrain-tags='${setId}']`)).toBeVisible();
  await page.screenshot({ path: `${OUT}05-corner-fix.png` });
  const corner = await tilesetCell(image, 0, 0, 0.2, 0.2); // tile 0, NW corner: dirt → grass
  await page.mouse.click(corner.x, corner.y);
  await expect
    .poll(async () => JSON.stringify((await terrainSets(page))[0]!.tiles.find((t) => (t as { tileId: number }).tileId === 0)))
    .toContain("[2,1,1,1]");
  await page.locator("[data-action='terrain-fix-done']").click();

  expect(errors).toEqual([]);
});

test("eleven terrain gestures undo and redo every intermediate state, including an isolated click", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const image = await openProject(page, "blob47-godot-32.png");
  await roughSelect(page, image, 1, 0, 10, 3);
  const card = page.locator("[data-inspector-terrain='define']");
  await card.locator("[data-terrain-name-input]").fill("Çimen");
  await card.locator("[data-action='terrain-define']").click();
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { getCanvasHandle } = await import(/* @vite-ignore */ String("/src/ui/canvas/canvasHandle.ts"));
    const s = useEditorStore.getState();
    s.setTool("brush"); s.setBrushSize(1);
    s.project.store.clearHistory();
    getCanvasHandle().setZoom(1);
  });
  await expect.poll(async () => (await cellPoint(page, 17, 15)).x - (await cellPoint(page, 16, 15)).x).toBe(32);
  await page.evaluate(async () => {
    const { getCanvasHandle } = await import(/* @vite-ignore */ String("/src/ui/canvas/canvasHandle.ts"));
    getCanvasHandle().centerOn(16, 15);
  });
  const canvas = page.locator("canvas[aria-label='map canvas']").first();
  await canvas.focus();
  const cells = () => page.evaluate(() => {
    const h = (window as unknown as { __smap: Hook }).__smap;
    const layer = h.store.document.layers.find(l => l.id === h.editor.getState().activeLayerId)!;
    return Array.from({ length: 40 * 32 }, (_, i) => layer.getCell(i % 40, Math.floor(i / 40)));
  });
  const states = [await cells()];
  const stroke = async (x: number, y: number, endX = x, endY = y) => {
    const a = await cellPoint(page, x, y), b = await cellPoint(page, endX, endY);
    const box = (await canvas.boundingBox())!;
    for (const p of [a, b]) expect(p.y).toBeGreaterThan(box.y);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 }); await page.mouse.up();
    const next = await cells();
    expect(next).not.toEqual(states.at(-1));
    states.push(next);
  };
  for (let y = 10; y <= 16; y++) await stroke(9, y, 18, y);
  await stroke(19, 13, 22, 13);
  await stroke(23, 9);
  await page.keyboard.press("e");
  await stroke(13, 13);
  await stroke(16, 15, 17, 16);
  for (let i = states.length - 2; i >= 0; i--) {
    await page.keyboard.press("Control+z");
    expect(await cells()).toEqual(states[i]);
  }
  for (let i = 1; i < states.length; i++) {
    await page.keyboard.press("Control+y");
    expect(await cells()).toEqual(states[i]);
  }
});
