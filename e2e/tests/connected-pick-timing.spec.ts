import { expect, test } from "../support/fixtures";
import { setup, click, at, canvas } from "../support/connectedPick";

// Tracing screenshots block SwiftShader; keep the timing probe free of tracing overhead.
test.use({ trace: "off" });

test("a 200×200 connected selection keeps browser and app frames below 100 ms during the click", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    (window as unknown as { __smapPerf: { frames: unknown[] } }).__smapPerf = { frames: [] };
    const s = useEditorStore.getState(), store = s.project.store;
    store.dispatch({ type: "resizeMap", width: 200, height: 200 });
    const layerId = store.dispatch({ type: "addLayer", layer: { name: "Large" } });
    const cell = store.getOrAddPaletteIndex(store.document.tilesets[0].id, 1);
    store.dispatch({ type: "paintCells", layerId, cells: Array.from({ length: 40000 }, (_, i) => ({ x: i % 200, y: Math.floor(i / 200), cell })) });
    s.setActiveLayer(layerId); store.clearHistory();
    // Normal painting zoom: the component extends well beyond the viewport.
    (window as unknown as { __smap: { setCamera(x: number, y: number, z: number): void } }).__smap.setCamera(40, 40, 1);
  });
  await expect.poll(() => page.evaluate(() => {
    const w = window as unknown as { __smap: { store: { revision: number }; backgroundPending: boolean }; __smapPerf: { frames: { revision: number; thumbPending: boolean }[] } };
    const last = w.__smapPerf.frames.at(-1);
    return last?.revision === w.__smap.store.revision && !last.thumbPending && !w.__smap.backgroundPending;
  }), { timeout: 30000 }).toBe(true);
  await page.getByRole("radio", { name: "Bağlı alan", exact: true }).click();
  // Finish toolbar-to-canvas focus and hover before timing the canvas gesture,
  // as the existing perf harness does for brush input.
  await canvas(page).focus();
  const pointer = await at(page, 3, 3);
  await page.mouse.move(pointer.x, pointer.y);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.evaluate(() => {
    const w = window as unknown as { pickFrames: number[]; pickInputs: number[]; pickStop: boolean; pickLongFrames: number[]; pickObserver: PerformanceObserver; __smapPerf: { frames: { start: number; end: number }[]; selectionQueries: number[] } };
    w.__smapPerf = { frames: [], selectionQueries: [] };
    w.pickFrames = []; w.pickInputs = []; w.pickStop = false; w.pickLongFrames = [];
    if (!PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) throw new Error("Long Animation Frames API required by the frame budget probe");
    w.pickObserver = new PerformanceObserver(list => { w.pickLongFrames.push(...list.getEntries().map(e => e.duration)); });
    w.pickObserver.observe({ type: "long-animation-frame" });
    const c = document.querySelector("canvas[aria-label='map canvas']")!;
    // Capture through the end of the canvas handler, including component computation.
    for (const type of ["pointerdown", "pointerup"]) {
      let start = 0;
      c.addEventListener(type, () => { start = performance.now(); }, { once: true, capture: true });
      c.addEventListener(type, () => { w.pickInputs.push(performance.now() - start); }, { once: true });
    }
    c.addEventListener("pointerdown", () => {
      let last = performance.now();
      const frame = () => { const now = performance.now(); w.pickFrames.push(now - last); last = now; if (!w.pickStop) requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    }, { once: true, capture: true });
  });
  await click(page, 3, 3);
  const measured = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const w = window as unknown as { pickFrames: number[]; pickInputs: number[]; pickStop: boolean; pickLongFrames: number[]; pickObserver: PerformanceObserver; __smapPerf: { frames: { start: number; end: number }[]; selectionQueries: number[] } }; w.pickStop = true; w.pickLongFrames.push(...w.pickObserver.takeRecords().map(e => e.duration)); w.pickObserver.disconnect();
    const s = useEditorStore.getState(); return { longFrames: w.pickLongFrames, rafGaps: w.pickFrames, inputs: w.pickInputs, queries: w.__smapPerf.selectionQueries, appFrames: w.__smapPerf.frames.map(f => f.end - f.start), count: s.region.mask.reduce((a: number, b: number) => a + b, 0), undo: s.project.store.undoDepth };
  });
  console.log("connected selection 200x200 frame ms", measured);
  expect(measured.count).toBe(40000); expect(measured.undo).toBe(0);
  // Browser frame duration includes script, style and layout. RAF spacing also
  // includes idle/scheduler time, so retain it as diagnostic data only.
  expect(measured.rafGaps.length).toBeGreaterThan(0);
  expect(Math.max(0, ...measured.longFrames)).toBeLessThan(100);
  expect(measured.inputs).toHaveLength(2); expect(measured.queries).toHaveLength(1);
  expect(Math.max(...measured.inputs)).toBeLessThan(100);
  expect(measured.appFrames.length).toBeGreaterThan(0);
  expect(measured.queries[0]! + Math.max(...measured.appFrames)).toBeLessThan(100);
});

test("a fully visible 200×200 comb keeps the initial click and later ant frames below 100 ms at 10% zoom", async ({ page }) => {
  test.setTimeout(120000);
  await setup(page);
  await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const s = useEditorStore.getState(), store = s.project.store;
    store.dispatch({ type: "resizeMap", width: 200, height: 200 });
    const layerId = store.dispatch({ type: "addLayer", layer: { name: "Comb" } });
    const cell = store.getOrAddPaletteIndex(store.document.tilesets[0].id, 1);
    store.dispatch({ type: "paintCells", layerId, cells: Array.from({ length: 40000 }, (_, i) => ({ x: i % 200, y: Math.floor(i / 200), cell: i % 200 === 0 || Math.floor(i / 200) % 2 === 0 ? cell : 0 })) });
    s.setActiveLayer(layerId); store.clearHistory();
    const w = window as unknown as { __smap: { setCamera(x: number, y: number, z: number): void }; __smapPerf: { frames: unknown[] } };
    w.__smapPerf = { frames: [] };
    w.__smap.setCamera(20, 20, 0.1);
  });
  await expect.poll(() => page.evaluate(() => {
    const w = window as unknown as { __smap: { store: { revision: number }; backgroundPending: boolean }; __smapPerf: { frames: { revision: number; thumbPending: boolean }[] } };
    const last = w.__smapPerf.frames.at(-1);
    return last?.revision === w.__smap.store.revision && !last.thumbPending && !w.__smap.backgroundPending;
  }), { timeout: 30000 }).toBe(true);
  await page.getByRole("radio", { name: "Bağlı alan", exact: true }).click();
  await canvas(page).focus();
  const pointer = await at(page, 3, 2);
  const corner = await at(page, 199, 199), box = await canvas(page).boundingBox();
  expect(corner.x).toBeLessThan(box!.x + box!.width);
  expect(corner.y).toBeLessThan(box!.y + box!.height);
  await page.mouse.move(pointer.x, pointer.y);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.evaluate(() => {
    const w = window as unknown as { __smapPerf: unknown; combClickStart: number };
    w.__smapPerf = { frames: [], selectionQueries: [] };
    w.combClickStart = Infinity;
    // mouse.click also sends a move: time selection frames from the actual press.
    document.querySelector("canvas[aria-label='map canvas']")!.addEventListener("pointerdown", () => {
      w.combClickStart = performance.now();
    }, { once: true, capture: true });
  });
  await click(page, 3, 2);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const initial = await page.evaluate(() => {
    const w = window as unknown as { combClickStart: number; __smapPerf: { frames: { start: number; end: number }[]; selectionQueries: number[] } };
    const result = {
      frames: w.__smapPerf.frames.filter(f => f.start >= w.combClickStart).map(f => f.end - f.start),
      preClickFrames: w.__smapPerf.frames.filter(f => f.start < w.combClickStart).map(f => f.end - f.start),
      queries: [...w.__smapPerf.selectionQueries],
    };
    w.__smapPerf.frames = [];
    return result;
  });
  console.log("connected comb initial frame ms", initial);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __smapPerf: { frames: unknown[] } }).__smapPerf.frames.length), { timeout: 30000 }).toBeGreaterThanOrEqual(5);
  const later = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const s = useEditorStore.getState();
    const w = window as unknown as { __smapPerf: { frames: { start: number; end: number }[] } };
    return { frames: w.__smapPerf.frames.map(f => f.end - f.start), count: s.region.mask.reduce((a: number, b: number) => a + b, 0), undo: s.project.store.undoDepth };
  });
  console.log("connected comb 200x200 at 10% frame ms", { initial, later });
  expect(later.count).toBe(20100); expect(later.undo).toBe(0);
  expect(initial.queries).toHaveLength(1); expect(initial.frames.length).toBeGreaterThan(0);
  expect(initial.queries[0]! + Math.max(...initial.frames)).toBeLessThan(100);
  expect(Math.max(...later.frames)).toBeLessThan(100);
});
