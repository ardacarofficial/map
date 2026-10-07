import type { Page } from "@playwright/test";

import { dropFile, expect, readOpfsText, sampleBytes, test } from "../support/fixtures";

// CLAUDE.md v1.0 (several levels, level list in a side panel) and v1.1
// (portal: target level by id, double-click opens it at the target point).

interface Hook {
  editor: { getState(): { project: { levelId?: string; store: unknown } | null; setTool(t: string): void; setSelectedEntity(id: string | null): void } };
  store: { dispatch(op: unknown): unknown; document: { map: { tileWidth: number } } } | null;
  cellCenter(x: number, y: number): { x: number; y: number } | null;
}

const levelRow = (page: Page, name: string) => page.getByRole("listbox", { name: "Level'lar" }).getByRole("option", { name });

async function drawStroke(page: Page, dx: number) {
  const canvas = page.locator("canvas[aria-label='map canvas']").first();
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2 + dx;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 80, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 20, { steps: 10 });
  await page.mouse.up();
}

function chunksOf(text: string | null): number {
  const level = JSON.parse(text ?? "{}") as { layers?: { chunks?: unknown[] }[] };
  return (level.layers ?? []).reduce((n, l) => n + (l.chunks?.length ?? 0), 0);
}

test("v1.0: two levels drawn, saved, reopened intact; v1.1 portal navigates", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await dropFile(page, "[role=button][tabindex='0']", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  const tileGrid = page.getByRole("grid", { name: /overworld/i });
  await expect(tileGrid).toBeVisible();
  const image = tileGrid.locator(".checker");
  const imageBox = (await image.boundingBox())!;
  await image.click({ position: { x: imageBox.width * 0.4, y: imageBox.height * 0.2 } });

  // Level 1 ("main") is listed and active.
  await expect(levelRow(page, "main")).toHaveAttribute("aria-selected", "true");
  await drawStroke(page, -40);

  // New level "Zindan".
  await page.getByRole("button", { name: "Yeni level" }).click();
  const dialog = page.locator("[data-dialog='new-level']");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Ad").fill("Zindan");
  await dialog.getByRole("button", { name: "Oluştur" }).click();
  await expect(levelRow(page, "Zindan")).toHaveAttribute("aria-selected", "true");
  await drawStroke(page, 40);
  // Both levels have unsaved changes.
  await expect(page.locator("[data-level-dirty]")).toHaveCount(2);

  await page.keyboard.press("Control+s");
  await expect.poll(() => readOpfsText(page, "levels/zindan.json")).not.toBeNull();
  await expect(page.locator("[data-level-dirty]")).toHaveCount(0);
  const mainText = await readOpfsText(page, "levels/main.json");
  const zindanText = await readOpfsText(page, "levels/zindan.json");
  expect(chunksOf(mainText)).toBeGreaterThan(0);
  expect(chunksOf(zindanText)).toBeGreaterThan(0);
  expect(mainText).not.toBe(zindanText);

  // Close the program, open the project again: both levels come back.
  await page.reload();
  await page.getByRole("button", { name: /Aç.*Bir proje klasörü seç/ }).click();
  await expect(levelRow(page, "main")).toHaveAttribute("aria-selected", "true");
  await expect(levelRow(page, "Zindan")).toBeVisible();
  await levelRow(page, "Zindan").click();
  await expect(levelRow(page, "Zindan")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+s");
  await expect.poll(() => readOpfsText(page, "levels/zindan.json")).toBe(zindanText);
  expect(await readOpfsText(page, "levels/main.json")).toBe(mainText);

  // ---- Portal in "main" leading to "Zindan".
  await levelRow(page, "main").click();
  await expect(levelRow(page, "main")).toHaveAttribute("aria-selected", "true");
  const entityId = await page.evaluate(() => {
    const smap = (window as unknown as { __smap: Hook }).__smap;
    const store = smap.store!;
    const layerId = store.dispatch({ type: "addLayer", layer: { name: "Entity", type: "entity" } });
    const tile = store.document.map.tileWidth;
    const id = store.dispatch({ type: "addEntity", layerId, entity: { typeId: "portal", x: 3 * tile, y: 3 * tile } }) as string;
    smap.editor.getState().setTool("select");
    smap.editor.getState().setSelectedEntity(id);
    return id;
  });
  const props = page.locator(`[data-entity-properties='${entityId}']`);
  await expect(props).toBeVisible();
  await props.getByLabel("Hedef level").selectOption({ label: "Zindan" });
  await expect(props.locator("[data-portal-status='ok']")).toBeVisible();

  // "Haritada seç": Zindan opens, a click there sets the point, back in main.
  await props.getByRole("button", { name: "Haritada seç" }).click();
  await expect(page.locator("[data-point-pick]")).toBeVisible();
  await expect(levelRow(page, "Zindan")).toHaveAttribute("aria-selected", "true");
  const target = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.cellCenter(5, 4));
  await page.mouse.click(target!.x, target!.y);
  await expect(page.locator("[data-point-pick]")).toBeHidden();
  await expect(levelRow(page, "main")).toHaveAttribute("aria-selected", "true");
  await expect(props.getByLabel("Hedef nokta x")).toHaveValue("160");
  await expect(props.getByLabel("Hedef nokta y")).toHaveValue("128");

  // Double-click the portal: Zindan opens.
  const portal = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.cellCenter(3, 3));
  await page.mouse.dblclick(portal!.x, portal!.y);
  await expect(levelRow(page, "Zindan")).toHaveAttribute("aria-selected", "true");

  // Palette: "Level'a git: main".
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("level'a git main");
  await page.keyboard.press("Enter");
  await expect(levelRow(page, "main")).toHaveAttribute("aria-selected", "true");

  expect(errors).toEqual([]);
});
