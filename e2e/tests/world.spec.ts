import type { Page } from "@playwright/test";

import { dropFile, expect, readOpfsText, sampleBytes, test } from "../support/fixtures";

// CLAUDE.md v1.2: the world map is a second view of the same canvas; levels
// are dragged (snapping to the grid) and their positions are saved.

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  world: { x: number; y: number };
}

const levelRow = (page: Page, name: string) => page.getByRole("listbox", { name: "Level'lar" }).getByRole("option", { name });

const worldBoxes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __smap?: { worldBoxes(): Box[] } }).__smap?.worldBoxes() ?? []);

async function levelIds(page: Page): Promise<Record<string, string>> {
  const text = await readOpfsText(page, "project.smap");
  const project = JSON.parse(text ?? "{}") as { levels: { id: string; name: string }[] };
  return Object.fromEntries(project.levels.map((l) => [l.name, l.id]));
}

async function worldOf(page: Page, id: string): Promise<{ x: number; y: number } | null> {
  const text = await readOpfsText(page, "project.smap");
  const project = JSON.parse(text ?? "{}") as { levels: { id: string; world?: { x: number; y: number } }[] };
  return project.levels.find((l) => l.id === id)?.world ?? null;
}

test("v1.2: world view shows both levels; a dragged level keeps its position after save + reopen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await dropFile(page, "[role=button][tabindex='0']", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await expect(page.getByRole("grid", { name: /overworld/i })).toBeVisible();
  await expect(levelRow(page, "main")).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Yeni level" }).click();
  const dialog = page.locator("[data-dialog='new-level']");
  await dialog.getByLabel("Ad").fill("Zindan");
  await dialog.getByRole("button", { name: "Oluştur" }).click();
  await expect(levelRow(page, "Zindan")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+s");
  await expect.poll(() => readOpfsText(page, "levels/zindan.json")).not.toBeNull();
  const ids = await levelIds(page);
  const zindanId = ids["Zindan"]!;
  const start = (await worldOf(page, zindanId))!;
  // A new level does not pile up on the first one.
  expect(start.x).toBeGreaterThan(0);

  // ---- Into the world view (toolbar toggle): both levels, only the level list.
  const view = page.getByRole("group", { name: "Görünüm" });
  await view.getByRole("button", { name: "Dünya" }).click();
  await expect(view.getByRole("button", { name: "Dünya" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-status-world]")).toContainText("Dünya · 2 level");
  await expect(page.getByRole("region", { name: "Katman" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Kalem" })).toBeDisabled();
  await expect.poll(async () => (await worldBoxes(page)).length).toBe(2);

  // ---- Drag Zindan down-right by about 3 × 2 tiles (snaps to the 32 px grid).
  const box = (await worldBoxes(page)).find((b) => b.id === zindanId)!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 40, { steps: 8 });
  await page.mouse.move(cx + 120, cy + 80, { steps: 8 });
  await page.mouse.up();

  // The list (project.smap after save) has the new, snapped position; the project is dirty.
  await expect(page.getByRole("status", { name: "Kaydedilmemiş değişiklikler" })).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect.poll(async () => JSON.stringify(await worldOf(page, zindanId))).not.toBe(JSON.stringify(start));
  const moved = (await worldOf(page, zindanId))!;
  expect(moved.x % 32).toBe(0);
  expect(moved.y % 32).toBe(0);
  expect(moved.x).toBeGreaterThan(start.x);
  expect(moved.y).toBeGreaterThan(start.y);

  // ---- Esc returns to the level view.
  await page.locator("[data-canvas-host]").focus();
  await page.keyboard.press("Escape");
  await expect(view.getByRole("button", { name: "Harita" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Katman" })).toBeVisible();

  // ---- Reopen: the position is still there, and the world view shows it.
  await page.reload();
  await page.getByRole("button", { name: /Aç.*Bir proje klasörü seç/ }).click();
  await expect(levelRow(page, "main")).toHaveAttribute("aria-selected", "true");
  await page.locator("[data-canvas-host]").focus();
  await page.keyboard.press("w");
  await expect(page.locator("[data-status-world]")).toBeVisible();
  await expect
    .poll(async () => (await worldBoxes(page)).find((b) => b.id === zindanId)?.world)
    .toEqual(moved);

  // ---- A click on a level opens it in the level view.
  const again = (await worldBoxes(page)).find((b) => b.id === zindanId)!;
  await page.mouse.click(again.x + again.width / 2, again.y + again.height / 2);
  await expect(levelRow(page, "Zindan")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-status-world]")).toBeHidden();

  // ---- Levels panel click while in the world view opens that level too.
  await page.keyboard.press("w");
  await expect(page.locator("[data-status-world]")).toBeVisible();
  await levelRow(page, "main").click();
  await expect(levelRow(page, "main")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-status-world]")).toBeHidden();

  expect(errors).toEqual([]);
});
