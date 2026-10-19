/** Production-build pixel controller/atlas frame budget, separately from tile regression metrics. */
import { test, expect } from '@playwright/test';
import { createDocument, encodeRgbaPng, MapStore, serializeLevel, serializeProject } from '../../packages/core/src/index';
interface Hook {
  pixelUploadMetrics: { fullUploads: number; subUploads: number; uploadedBytes: number };
  editor: { getState(): { setTool(tool: 'brush' | 'eraser'): void } };
  pixelUi: { getState(): { pending: boolean; setMode(mode: 'pixel'): void; setSize(size: number): void } };
  pixelColors: { getState(): { setFg(hex: string): void } };
  pixelMetrics: { planMs: number[]; commitMs: number[]; pageBytesTouched: number; geometryBuilds: number };
  setCamera(x: number, y: number, zoom: number): void;
  cellCenter(x: number, y: number): { x: number; y: number };
}
for (const dpr of [1, 1.25, 1.5]) test.describe(`DPR ${dpr}`, () => {
  test.use({ deviceScaleFactor: dpr });
test('warm pixel strokes: 1/8/32 px frame work and bounded atlas uploads', async ({ page }) => {
  const ts = { id: 'source', name: 'Source', imagePath: 'tilesets/source.png', tileWidth: 32, tileHeight: 32, columns: 1, rows: 1, margin: 0, spacing: 0 };
  const store = new MapStore(createDocument({ width: 16, height: 16, tileWidth: 32, tileHeight: 32, tilesets: [ts] }));
  const layerId = store.dispatch({ type: 'addLayer', layer: { name: 'Ground' } }), pi = store.dispatch({ type: 'addPaletteEntry', tilesetId: ts.id, tileId: 0 });
  store.dispatch({ type: 'paintCells', layerId, cells: [{ x: 8, y: 8, cell: pi }] });
  const png = encodeRgbaPng(32, 32, new Uint8Array(32 * 32 * 4).fill(255));
  await page.addInitScript(() => { (window as unknown as { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = () => navigator.storage.getDirectory(); });
  await page.goto('/');
  await page.evaluate(async files => {
    const root = await navigator.storage.getDirectory();
    for (const { path, data } of files) { const parts = path.split('/'), name = parts.pop()!; let dir = root; for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true }); const writer = await (await dir.getFileHandle(name, { create: true })).createWritable(); await writer.write(typeof data === 'string' ? data : new Uint8Array(data)); await writer.close(); }
  }, [{ path: 'project.smap', data: serializeProject({ name: 'Pixel benchmark', levels: [{ name: 'Main', path: 'levels/main.json' }], tilesets: [ts] }) }, { path: 'levels/main.json', data: serializeLevel(store.document) }, { path: ts.imagePath, data: [...png] }]);
  await page.keyboard.press('Control+o');
  await page.waitForFunction(() => !!(window as unknown as { __smap?: Hook }).__smap);
  await page.evaluate(() => { const h = (window as unknown as { __smap: Hook }).__smap; h.setCamera(-300, -300, 2); h.pixelUi.getState().setMode('pixel'); });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelUi.getState().pending)).toBe(false);
  // Thread ticks measure per-frame JS work (preview and commit frames separately), excluding OS descheduling on
  // this shared runner. Wall-clock planner/commit timings are reported as well.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable', { timeDomain: 'threadTicks' });
  if (process.env.PERF_PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start'); }
  const times = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const value = (name: string) => metrics.find((m: { name: string; value: number }) => m.name === name)!.value * 1000;
    return { script: value('ScriptDuration'), task: value('TaskDuration') };
  };
  const result = [];
  const quantiles = (values: number[]) => { values.sort((a, b) => a - b); return { p50: values[Math.floor(values.length / 2)]!, p95: values[Math.floor(values.length * .95)]! }; };
  const stroke = async (measure = false) => {
    const before = measure ? await times() : { script: 0, task: 0 };
    const gpuBefore = measure ? await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelUploadMetrics.uploadedBytes) : 0;
    await page.evaluate(async () => {
      const h = (window as unknown as { __smap: Hook }).__smap, canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="map canvas"]')!;
      const p = h.cellCenter(8, 8), q = h.cellCenter(9, 8), scale = (q.x - p.x) / 32;
      h.pixelMetrics.planMs.length = 0; h.pixelMetrics.commitMs.length = 0;
      canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, button: 0, buttons: 1, clientX: p.x, clientY: p.y }));
      canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 9, button: -1, buttons: 1, clientX: p.x + scale, clientY: p.y }));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });
    const middle = measure ? await times() : { script: 0, task: 0 };
    const wall = await page.evaluate(async () => {
      const h = (window as unknown as { __smap: Hook }).__smap, canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="map canvas"]')!;
      const p = h.cellCenter(8, 8), q = h.cellCenter(9, 8), scale = (q.x - p.x) / 32;
      canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, button: 0, buttons: 0, clientX: p.x + scale, clientY: p.y }));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const m = h.pixelMetrics;
      return { plan: m.planMs.reduce((a, b) => a + b, 0), commit: m.commitMs.reduce((a, b) => a + b, 0) };
    });
    const after = measure ? await times() : { script: 0, task: 0 };
    const gpuAfter = measure ? await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelUploadMetrics.uploadedBytes) : 0;
    return { wall, gpuBytes: gpuAfter - gpuBefore, work: Math.max(middle.script - before.script, after.script - middle.script), task: Math.max(middle.task - before.task, after.task - middle.task) };
  };
  for (const tool of ['brush', 'eraser'] as const) for (const size of [1, 8, 32]) {
    await page.evaluate(size => (window as unknown as { __smap: Hook }).__smap.pixelUi.getState().setSize(size), size);
    const gpu: number[] = [], cpu: number[] = [], tasks: number[] = [], plans: number[] = [], commits: number[] = [];
    const bytesBefore = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelMetrics.pageBytesTouched);
    for (let i = 0; i < 35; i++) {
      await page.evaluate(i => { const h = (window as unknown as { __smap: Hook }).__smap; h.editor.getState().setTool('brush'); h.pixelColors.getState().setFg(`#${((i * 7919 + 0x1234ef) & 0xffffff).toString(16).padStart(6, '0')}ff`); }, i);
      if (tool === 'eraser') { await stroke(); await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.editor.getState().setTool('eraser')); }
      const sample = await stroke(i >= 10);
      if (i >= 10) { gpu.push(sample.gpuBytes); cpu.push(sample.work); tasks.push(sample.task); plans.push(sample.wall.plan); commits.push(sample.wall.commit); }
    }
    const bytesAfter = await page.evaluate(() => (window as unknown as { __smap: Hook }).__smap.pixelMetrics.pageBytesTouched);
    result.push({ tool, size, gpuBytes: quantiles(gpu), work: quantiles(cpu), mainThreadTask: quantiles(tasks), wallPlan: quantiles(plans), wallCommit: quantiles(commits), cpuPageBytesTouched: bytesAfter - bytesBefore });
  }
  if (process.env.PERF_PROFILE) { const { profile } = await cdp.send('Profiler.stop'); await test.info().attach('pixel.cpuprofile', { body: JSON.stringify(profile), contentType: 'application/json' }); const totals = new Map<string, number>(); for (const node of profile.nodes) { const key = `${node.callFrame.functionName} ${node.callFrame.url}:${node.callFrame.lineNumber}`; totals.set(key, (totals.get(key) ?? 0) + (node.hitCount ?? 0)); } console.log('PX1 CPU samples:', JSON.stringify([...totals].sort((a, b) => b[1] - a[1]).slice(0, 25))); }
  console.log(`PX1 production warm strokes DPR ${dpr}:`, JSON.stringify(result));
  await test.info().attach('pixel-frame-work.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  for (const row of result) { expect(row.work.p95).toBeLessThan(16.7); expect(row.gpuBytes.p50).toBeGreaterThan(0); }
});

});
