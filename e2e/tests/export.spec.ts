import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

import { dropFile, expect, readOpfsText, sampleBytes, test } from "../support/fixtures";

const UNITY_DIR = "unity-maps";

/** Bytes of an OPFS file as a plain array, or null when missing. */
async function readOpfsBytes(page: Page, path: string): Promise<number[] | null> {
  return page.evaluate(async (path) => {
    try {
      let dir = await navigator.storage.getDirectory();
      const parts = path.split("/");
      const file = parts.pop() as string;
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
      return [...new Uint8Array(await (await (await dir.getFileHandle(file)).getFile()).arrayBuffer())];
    } catch {
      return null;
    }
  }, path);
}

/** Width and height from a PNG's IHDR chunk. */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function stroke(page: Page, dx: number, dy: number): Promise<void> {
  const canvas = page.locator("canvas[aria-label='map canvas']").first();
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2 + dx;
  const cy = box.y + box.height / 2 + dy;
  await page.mouse.move(cx - 100, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 100, cy + 20, { steps: 16 });
  await page.mouse.up();
}

// CLAUDE.md v0.4: PNG / JSON export, Unity export written into the Unity project, and
// "editörde kaydedince Unity'de güncellenir".
test("v0.4: export to a Unity folder, export on save, download a PNG", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // The Unity folder picker returns an OPFS sub-folder (the project picker keeps the root).
  await page.addInitScript((unityDir) => {
    const w = window as unknown as {
      showDirectoryPicker: (options?: { id?: string }) => Promise<FileSystemDirectoryHandle>;
    };
    w.showDirectoryPicker = async (options) => {
      const root = await navigator.storage.getDirectory();
      return options?.id === "smap-unity" ? root.getDirectoryHandle(unityDir, { create: true }) : root;
    };
  }, UNITY_DIR);

  await page.goto("/");
  await dropFile(page, "[role=button][tabindex='0']", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  const canvas = page.locator("canvas[aria-label='map canvas']").first();
  await expect(canvas).toBeVisible();
  const image = page.getByRole("grid", { name: /overworld/i }).locator(".checker");
  await expect(image).toBeVisible();
  const imageBox = (await image.boundingBox())!;
  await image.click({ position: { x: imageBox.width * 0.4, y: imageBox.height * 0.2 } });
  await canvas.focus();
  await page.keyboard.press("Shift+Digit1");
  await stroke(page, 0, -40);

  // ---- Unity export (Ctrl+E; Unity is the default target)
  await page.keyboard.press("Control+e");
  const dialog = page.getByRole("dialog", { name: "Dışa aktar" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /Unity/ })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByText("main.smapmap")).toBeVisible();
  await dialog.getByRole("button", { name: "Unity'ye aktar" }).click();
  await expect(page.getByText(/Unity'ye aktarıldı · \d\d:\d\d/)).toBeVisible();
  await expect(dialog).toBeHidden();

  const mapText = await readOpfsText(page, `${UNITY_DIR}/main.smapmap`);
  expect(mapText).not.toBeNull();
  const map = JSON.parse(mapText!) as { smapExport: number; width: number; tilesets: { image: string }[]; layers: { cells: number[] }[] };
  expect(map.smapExport).toBe(1);
  expect(map.width).toBe(64);
  expect(map.tilesets.map((ts) => ts.image)).toEqual(["overworld-32.png"]);
  expect(map.layers[0]!.cells.length).toBeGreaterThan(0);
  const png = await readOpfsBytes(page, `${UNITY_DIR}/overworld-32.png`);
  expect(png).toEqual(sampleBytes("tilesets/overworld-32.png"));

  // ---- "Kaydedince Unity'ye de aktar": draw more, save, the .smapmap follows
  await page.keyboard.press("Control+e");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("export-folder")).toHaveText(UNITY_DIR);
  await dialog.getByRole("switch", { name: /Kaydedince Unity'ye de aktar/ }).click();
  await expect(dialog.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await canvas.focus();
  await stroke(page, 0, 60);
  await page.keyboard.press("Control+s");
  await expect.poll(() => readOpfsText(page, `${UNITY_DIR}/main.smapmap`)).not.toBe(mapText);

  // ---- PNG export at 2× (download)
  await page.keyboard.press("Control+e");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: /PNG/ }).click();
  await dialog.getByRole("radio", { name: /^2×/ }).click();
  await expect(dialog.getByTestId("png-size")).toHaveText("4096 × 3072 px");
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "PNG indir" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("main.png");
  const bytes = new Uint8Array(readFileSync((await download.path())!));
  expect([...bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // "PNG"
  expect(pngDimensions(bytes)).toEqual({ width: 4096, height: 3072 });

  expect(errors).toEqual([]);
});
