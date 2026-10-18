import { expect, test } from "../support/fixtures";
import { setup, at, canvas, click } from "../support/connectedPick";

test.use({ trace: "off" });

for (const deviceScaleFactor of [1, 1.25, 1.5, 2]) {
  test.describe(`selection outline at DPR ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });
    test("mask fill preserves holes, ants move and loop, and returning to a rectangle preserves its pixels", async ({ page }) => {
      test.setTimeout(180000);
      await setup(page);
      await canvas(page).focus();
      await page.evaluate(() => {
        (window as unknown as { __smap: { setCamera(x: number, y: number, zoom: number): void } }).__smap.setCamera(40, 40, 1);
      });
      const a = await at(page, 3, 3), b = await at(page, 4, 4);
      const patch = (p: { x: number; y: number }) => ({ x: p.x - 4, y: p.y - 4, width: 8, height: 8 });
      const selection = { x: a.x - 20, y: a.y - 20, width: b.x - a.x + 40, height: b.y - a.y + 40 };
      const capture = (clip: { x: number; y: number; width: number; height: number }, time = 0) => page.evaluate(async ({ clip, time }) => {
        const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
        const originalNow = performance.now.bind(performance);
        // Freeze only the frame being read; Playwright keeps its normal clock during interactions.
        Object.defineProperty(performance, "now", { configurable: true, value: () => time });
        try {
          const s = useEditorStore.getState(); if (s.region) s.setRegion({ ...s.region });
          (window as unknown as { __smap: { setCamera(x: number, y: number, zoom: number): void } }).__smap.setCamera(40, 40, 1);
          return await new Promise<string>(resolve => requestAnimationFrame(() => {
            // Read before compositing clears WebGL's drawing buffer, after the requested app frame.
            const source = document.querySelector<HTMLCanvasElement>("canvas[aria-label='map canvas']")!;
            const box = source.getBoundingClientRect(), scale = source.width / box.width;
            const image = document.createElement("canvas");
            image.width = Math.round(clip.width * scale); image.height = Math.round(clip.height * scale);
            image.getContext("2d")!.drawImage(source, (clip.x - box.x) * scale, (clip.y - box.y) * scale, image.width, image.height, 0, 0, image.width, image.height);
            resolve(image.toDataURL());
          }));
        } finally {
          Object.defineProperty(performance, "now", { configurable: true, value: originalNow });
        }
      }, { clip, time });
      const rectangle = async () => {
        await canvas(page).focus(); await page.keyboard.press("Escape");
        await page.getByRole("radio", { name: "Dikdörtgen", exact: true }).click();
        await page.mouse.move(a.x, a.y); await page.mouse.down();
        await page.mouse.move(b.x, b.y); await page.mouse.up();
        await page.mouse.move(10, 10);
      };
      await rectangle();
      const rectangularPixels = await capture(selection);
      await canvas(page).focus(); await page.keyboard.press("Escape");
      await page.mouse.move(10, 10);
      const emptyHole = await capture(patch(b)), unselected = await capture(patch(a));
      await page.getByRole("radio", { name: "Bağlı alan", exact: true }).click();
      await click(page, 3, 3); await page.mouse.move(10, 10);
      expect(await capture(patch(b))).toEqual(emptyHole);
      expect(await capture(patch(a))).not.toEqual(unselected);
      const topEdge = { x: a.x - 12, y: a.y - 18, width: 56, height: 4 };
      const phase0 = await capture(topEdge);
      expect(await capture(topEdge, 125)).not.toEqual(phase0);
      expect(await capture(topEdge, 1000)).toEqual(phase0);
      await rectangle();
      expect(await capture(selection)).toEqual(rectangularPixels);
    });
  });
}
