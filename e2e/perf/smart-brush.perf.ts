import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { dropFile, WELCOME_DROP } from "../support/fixtures";

for (const sheetSize of [256, 2048]) test(`cold and warm 3×3 brush preparation on a ${sheetSize}×${sheetSize} sheet`, async ({ browser, baseURL }) => {
  const fixture = [...readFileSync(new URL("../fixtures/smart-road-32.png", import.meta.url))];
  const durations: number[] = [], warm: number[] = [];
  const profiles: Record<string, number>[] = [];
  for (let run = 0; run < Number(process.env.PERF_RUNS ?? 5); run++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(baseURL!);
    await expect(page.locator(WELCOME_DROP)).toBeVisible();
    const bytes = await page.evaluate(async ({ fixture, sheetSize }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(fixture)], { type: "image/png" }));
      const canvas = new OffscreenCanvas(sheetSize, sheetSize), ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, sheetSize, sheetSize); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return [...new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer())];
    }, { fixture, sheetSize });
    await dropFile(page, WELCOME_DROP, `road-${sheetSize}.png`, bytes);
    const card = page.getByTestId("tileset-card"); await expect(card).toBeVisible();
    await card.getByLabel("Tile genişliği", { exact: true }).fill("32");
    await card.locator("button[type=submit]").click(); await expect(card).toBeHidden();
    await expect.poll(() => page.evaluate(() => Object.hasOwn(window, "__smap"))).toBe(true);
    const grid = page.locator("[data-tileset-grid]").first(); await expect(grid).toBeVisible();
    const box = (await grid.boundingBox())!, size = box.width / (sheetSize / 32);
    await page.mouse.move(box.x + 2.5 * size, box.y + 1.5 * size); await page.mouse.down();
    await page.mouse.move(box.x + 4.5 * size, box.y + 3.5 * size, { steps: 4 }); await page.mouse.up();
    const read = () => page.evaluate(() => (window as unknown as { __smap: { smartBrushPreparation: { durations: number[] } } }).__smap.smartBrushPreparation.durations);
    await expect.poll(async () => (await read()).length).toBe(1);
    await expect(page.getByRole("radio", { name: "Yol", exact: true })).toBeVisible();
    durations.push((await read())[0]!);
    profiles.push(await page.evaluate(() => (window as unknown as { __smap: { smartBrushPreparation: { profiles: { spans: Record<string, number> }[] } } }).__smap.smartBrushPreparation.profiles[0]!.spans));
    await page.mouse.move(box.x + 2.5 * size, box.y + 1.5 * size); await page.mouse.down();
    await page.mouse.move(box.x + 4.5 * size, box.y + 3.5 * size, { steps: 4 }); await page.mouse.up();
    await expect.poll(async () => (await read()).length).toBe(2);
    warm.push((await read())[1]!); await context.close();
  }
  const sorted = [...durations].sort((a, b) => a - b);
  const result = { sheet: `${sheetSize}×${sheetSize}`, selection: "3×3, 32px", durations, warm, profiles, medianMs: sorted[Math.floor(sorted.length / 2)]!, warmMedianMs: [...warm].sort((a, b) => a - b)[Math.floor(warm.length / 2)]! };
  console.info(`Smart brush cold preparation: ${JSON.stringify(result)}`);
  const dir = new URL("./results/", import.meta.url); mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(`${process.env.PERF_LABEL ?? "smart-brush"}-${sheetSize}.json`, dir), `${JSON.stringify(result, null, 2)}\n`);
  if (process.env.PERF_ASSERT_TARGETS === "1") { expect(result.medianMs).toBeLessThan(sheetSize === 2048 ? 100 : 30); expect(result.warmMedianMs).toBeLessThan(50); }
});
