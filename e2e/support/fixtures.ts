import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { test as base, expect, type Page } from "@playwright/test";

export { expect };

const SAMPLES = fileURLToPath(new URL("../../samples/", import.meta.url));

/** Bytes of a file under /samples, as a plain array (structured-clone friendly). */
export function sampleBytes(relativePath: string): number[] {
  return [...readFileSync(SAMPLES + relativePath)];
}

/**
 * Each Playwright test runs in a fresh browser context, so OPFS starts empty and is
 * isolated per test. It survives `page.reload()`, which is what simulates closing and
 * reopening the program. The stub makes the "folder picker" return the OPFS root, so
 * the app saves straight into it (an empty folder is used as-is, no sub-folder).
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = () =>
        navigator.storage.getDirectory();
    });
    await use(page);
  },
});

/** Drops a file (bytes from Node) onto an element via a synthetic DataTransfer. */
export async function dropFile(page: Page, selector: string, name: string, bytes: number[], type = "image/png"): Promise<void> {
  await page.evaluate(
    ({ selector, name, bytes, type }) => {
      const target = document.querySelector(selector);
      if (!target) throw new Error(`drop target not found: ${selector}`);
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], name, { type }));
      for (const kind of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
    },
    { selector, name, bytes, type },
  );
}

/** Text of a file in the OPFS root (the stubbed project folder); null when missing. */
export async function readOpfsText(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (path) => {
    try {
      let dir = await navigator.storage.getDirectory();
      const parts = path.split("/");
      const file = parts.pop() as string;
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
      return await (await (await dir.getFileHandle(file)).getFile()).text();
    } catch {
      return null;
    }
  }, path);
}

/** Fraction of differing pixels (any channel off by > 8) between two PNG buffers. */
export async function pixelDiffRatio(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ({ a, b }) => {
      const load = async (bytes: number[]) => {
        const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext("2d")!;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      };
      const [x, y] = await Promise.all([load(a), load(b)]);
      if (x.width !== y.width || x.height !== y.height) return 1;
      let diff = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          if (Math.abs((x.data[i + k] ?? 0) - (y.data[i + k] ?? 0)) > 8) {
            diff++;
            break;
          }
        }
      }
      return diff / (x.width * x.height);
    },
    { a: [...a], b: [...b] },
  );
}
