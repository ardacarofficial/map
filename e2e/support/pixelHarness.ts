import type { usePixelUi } from '../../packages/editor/src/state/pixelUi';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import type * as Core from '../../packages/core/src/index';
const corePath = `/@fs${fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))}`;
export interface Hook { pixelMetrics: { planMs: number[]; commitMs: number[]; pageBytesTouched: number; geometryBuilds: number }; store: Core.MapStore; editor: { getState(): { activeLayerId: string | null } }; pixelUi: typeof usePixelUi; pixelColors: { getState(): { fg: string; bg: string; setFg(hex: string): void } }; cellCenter(x: number, y: number): { x: number; y: number }; setCamera(x: number, y: number, zoom: number): void }
export async function open(page: Page) {
  await page.goto('/');
  const source = await page.evaluate(async path => {
    const c = await import(/* @vite-ignore */ path) as typeof Core;
    const ts = { id: 'source', name: 'Source', imagePath: 'tilesets/source.png', tileWidth: 16, tileHeight: 16, columns: 1, rows: 1, margin: 0, spacing: 0 };
    const make = () => { const s = new c.MapStore(c.createDocument({ width: 4, height: 4, tileWidth: 16, tileHeight: 16, tilesets: [ts] })); const id = s.dispatch({ type: 'addLayer', layer: { name: 'Ground' } }); const index = s.dispatch({ type: 'addPaletteEntry', tilesetId: ts.id, tileId: 0 }); s.dispatch({ type: 'paintCells', layerId: id, cells: [{ x: 0, y: 0, cell: index }, { x: 1, y: 0, cell: index }] }); return s; };
    const a = make(), b = make(), pixels = new Uint8Array(16 * 16 * 4).fill(255), png = c.encodeRgbaPng(16, 16, pixels);
    const project = c.serializeProject({ name: 'Pixel world', levels: [{ id: 'a', name: 'A', path: 'levels/main.json', world: { x: 0, y: 0 } }, { id: 'b', name: 'B', path: 'levels/b.json', world: { x: 5, y: 0 } }], tilesets: [ts] });
    for (const [path, data] of [['project.smap', project], ['levels/main.json', c.serializeLevel(a.document)], ['levels/b.json', c.serializeLevel(b.document)], ['tilesets/source.png', png]] as const) { const parts = path.split('/'), name = parts.pop()!; let dir = await navigator.storage.getDirectory(); for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true }); const writer = await (await dir.getFileHandle(name, { create: true })).createWritable(); await writer.write(typeof data === "string" ? data : new Uint8Array(data)); await writer.close(); }
    return [...png];
  }, corePath);
  await page.keyboard.press('Control+o');
  await expect(page.locator('canvas[aria-label="map canvas"]').first()).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as { __smap?: Hook }).__smap?.store);
  await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.setCamera(24, 48, 6));
  await page.locator('canvas[aria-label="map canvas"]').first().focus();
  return source;
}
export async function point(page: Page, x: number, y: number) { return page.evaluate(({ x, y }) => { const h = (window as unknown as { __smap: Hook }).__smap, a = h.cellCenter(0, 0), b = h.cellCenter(1, 0), scale = (b.x - a.x) / 16; return { x: a.x + (x - 8 + 0.5) * scale, y: a.y + (y - 8 + 0.5) * scale }; }, { x, y }); }
export async function click(page: Page, x: number, y: number, button: 'left' | 'right' = 'left') { const p = await point(page, x, y); await page.mouse.click(p.x, p.y, { button }); }
export async function drag(page: Page, x: number, y: number, endX: number, endY: number) { const a = await point(page, x, y), b = await point(page, endX, endY); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up(); }
export async function color(page: Page, value: string) { await page.getByRole('button', { name: 'Ön renk', exact: true }).click(); await page.getByRole('textbox', { name: 'HEX', exact: true }).fill(value); await page.keyboard.press('Enter'); await page.locator('canvas[aria-label="map canvas"]').first().focus(); }
export async function rgba(page: Page, cellX: number, cellY: number, x: number, y: number) { return page.evaluate(({ cellX, cellY, x, y }) => { const h = (window as unknown as { __smap: Hook }).__smap, d = h.store.document, layer = d.getLayer(h.editor.getState().activeLayerId!)!, cell = layer.getCell(cellX, cellY), e = d.palette.get(cell & 0x1fffffff); if (!e) return [0, 0, 0, 0]; if (e.tilesetId === 'source') return [255, 255, 255, 255]; const t = h.store.rasterAssets.getTile(e.tilesetId, e.tileId)!; return [...t.data.slice((y * t.width + x) * 4, (y * t.width + x) * 4 + 4)]; }, { cellX, cellY, x, y }); }
export async function gpuPixel(page: Page, x: number, y: number) {
  return page.evaluate(async ({ x, y }) => {
    const h = (window as unknown as { __smap: Hook }).__smap;
    h.setCamera(24, 48, 6);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="map canvas"]')!, box = canvas.getBoundingClientRect(), centre = h.cellCenter(0, 0), next = h.cellCenter(1, 0), scale = (next.x - centre.x) / 16;
    const sx = centre.x + (x - 8 + .5) * scale, sy = centre.y + (y - 8 + .5) * scale;
    const gl = canvas.getContext('webgl2')!, pixel = new Uint8Array(4), resolution = canvas.width / box.width;
    gl.readPixels(Math.floor((sx - box.left) * resolution), canvas.height - 1 - Math.floor((sy - box.top) * resolution), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel];
  }, { x, y });
}
export async function depth(page: Page) { return page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.store.undoDepth); }
export async function key(page: Page, value: string) { await page.locator('canvas[aria-label="map canvas"]').first().focus(); await page.keyboard.press(value); }
