import { dropFile, expect, pixelDiffRatio, readOpfsText, sampleBytes, test, confirmTilesetCard, WELCOME_DROP, expectWelcome } from "../support/fixtures";

/** Toasts float over the canvas ("Kaydedildi" vs "Açıldı"): keep them out of the comparison shots. */
const QUIET = "[data-toaster] { display: none !important; }";

// CLAUDE.md v0.1 "Bitti": tileset dropped, map drawn, saved, program closed and
// reopened -> the same map comes back.
test("v0.1: drop tileset, draw, save, reload, open -> same map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await expectWelcome(page);

  // Drop the tileset on the welcome drop zone.
  await dropFile(page, WELCOME_DROP, "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);

  const canvas = page.locator("canvas[aria-label='map canvas']").first(); // main canvas (the tileset preview shares the label)
  await expect(canvas).toBeVisible();
  const tileGrid = page.getByRole("grid", { name: /overworld/i });
  await expect(tileGrid).toBeVisible();

  // Pick a tile that is not the first one (offset inside the tileset image).
  const image = tileGrid.locator(".checker");
  await expect(image).toBeVisible();
  const imageBox = (await image.boundingBox())!;
  await image.click({ position: { x: imageBox.width * 0.4, y: imageBox.height * 0.2 } });
  await expect(page.getByText("Önce bir tile seç")).toBeHidden();

  // Deterministic camera (focus the canvas hover-free first, then frame the map).
  await canvas.focus();
  await page.keyboard.press("Shift+Digit1");
  await page.waitForTimeout(300);
  const emptyShot = await canvas.screenshot({ style: QUIET });
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 120, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 30, { steps: 12 });
  await page.mouse.move(cx + 120, cy - 20, { steps: 12 });
  await page.mouse.up();

  // Save (Ctrl+S, stubbed picker -> OPFS root).
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("img", { name: "Tüm değişiklikler kaydedildi" }).or(page.getByLabel("Tüm değişiklikler kaydedildi"))).toBeVisible();
  await expect.poll(() => readOpfsText(page, "project.smap")).not.toBeNull();
  const levelBefore = await readOpfsText(page, "levels/main.json");
  expect(levelBefore).not.toBeNull();
  expect(JSON.parse(levelBefore!)).toBeTruthy();

  await page.mouse.move(2, 2); // no brush hover preview in the shot
  await page.keyboard.press("Shift+Digit1");
  await page.waitForTimeout(300);
  const shotBefore = await canvas.screenshot({ style: QUIET });

  // "Close the program": reload (OPFS persists), then open the project.
  await page.reload();
  await expectWelcome(page);
  await page.getByRole("button", { name: /^Aç/ }).click();
  await expect(canvas).toBeVisible();
  await expect(page.getByRole("grid", { name: /overworld/i })).toBeVisible();

  await page.keyboard.press("Shift+Digit1");
  await page.waitForTimeout(300);
  const shotAfter = await canvas.screenshot({ style: QUIET });
  expect(await pixelDiffRatio(page, shotBefore, shotAfter)).toBeLessThan(0.002);
  // Sanity: the stroke is actually visible (an empty map would differ from the drawn one).
  expect(Buffer.compare(shotBefore, emptyShot)).not.toBe(0);

  // Re-save and compare file text byte for byte.
  await page.keyboard.press("Control+s");
  await expect.poll(async () => readOpfsText(page, "levels/main.json")).toBe(levelBefore);
  expect(errors).toEqual([]);
});
