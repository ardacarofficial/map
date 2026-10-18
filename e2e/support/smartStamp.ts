import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

/** Real dock selection and inline save; never fabricates a brush or usage. */
export async function makeRoadStamp(page: Page): Promise<void> {
  const { openRoadSheet, selectRoad, saveRoad } = await import("./smartStampDock");
  await openRoadSheet(page, 32, "", "road-source"); await selectRoad(page); await saveRoad(page);
  await expect(page.getByRole("radio", { name: "Yol", exact: true })).toBeVisible();
}
/** Lifecycle tests need a published, unused saved asset. Normal project save publishes it. */
export async function acceptRoadStamp(page: Page): Promise<void> {
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const { useUiStore } = await import(/* @vite-ignore */ String("/src/ui/uiStore.ts"));
    return !useUiStore.getState().busy && useEditorStore.getState().project.store.document.tilesets.some((t: {generated?:unknown})=>t.generated);
  })).toBe(true);
  await expect(page.locator("[data-smart-stamp-mode]")).toHaveAttribute("data-smart-stamp-mode", "road");
}
export async function cellPoint(page: Page, x: number, y: number) {
  return page.evaluate(([x, y]) => (window as unknown as { __smap: { cellCenter(x: number, y: number): { x: number; y: number } } }).__smap.cellCenter(x!, y!), [x, y]);
}
export async function dragRoad(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  const first = await cellPoint(page, ...points[0]!);
  await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const p of points.slice(1)) { const at = await cellPoint(page, ...p); await page.mouse.move(at.x, at.y, { steps: 4 }); }
  await page.mouse.up();
}
