/**
 * Editor performance scenarios (see playwright.config.ts in this folder):
 *
 * (a) welcome screen: first contentful paint, welcome visible, main thread quiet
 * (b) open a 1024×1024, 4-layer, fully painted project → first map frame
 * (c) brush latency at 100% and 25% zoom (input event → end of the frame that shows it)
 * (d) pan / zoom frame times at several zooms, incl. far-zoom LOD
 * (e) fill of a 1024×1024 region and its undo (input → frame)
 * (f) JS heap after (b)–(e)
 * (g) save time of that project
 *
 * Times are main-thread milliseconds measured in the page (`performance.now`,
 * the canvas's frame log `window.__smapPerf.frames`).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test, type Browser, type CDPSession, type Page } from "@playwright/test";

import { generateBigProject, type ProjectFiles } from "./bigProject";
import { formatTable, median, percentile, summarizeProfile, type Results } from "./report";

const RESULTS = fileURLToPath(new URL("./results/", import.meta.url));
const LABEL = process.env.PERF_LABEL ?? "latest";
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const PROFILE = process.env.PERF_PROFILE === "1";
/** `PERF_ONLY=c,e` runs only those scenarios ((b) always opens the project for the rest). */
const ONLY = process.env.PERF_ONLY?.split(",").map((s) => s.trim());
const want = (scenario: string) => !ONLY || ONLY.includes(scenario);

interface Frame {
  start: number;
  end: number;
  revision: number;
  scene: boolean;
  lod: boolean;
  thumbPending: boolean;
}
interface InputRecord {
  type: string;
  t: number;
  capture: number;
  revBefore: number;
  revAfter: number;
  handlerEnd: number;
  coalesced: number;
}
interface LongTask {
  start: number;
  duration: number;
}

/** Installed before any page script: frame log, input log, long tasks, OPFS folder picker. */
function initScript(): void {
  const w = window as unknown as Record<string, unknown>;
  const perf = { frames: [] as unknown[], inputs: [] as InputRecord[], longtasks: [] as LongTask[], welcomeAt: -1, recording: false };
  w.__smapPerf = perf;
  w.showDirectoryPicker = () => navigator.storage.getDirectory();
  const rev = () => (w.__smap as { store: { revision: number } | null } | undefined)?.store?.revision ?? -1;
  for (const type of ["pointermove", "pointerdown", "keydown"]) {
    window.addEventListener(
      type,
      (e) => {
        if (!perf.recording) return;
        const pe = e as PointerEvent;
        perf.inputs.push({
          type,
          t: e.timeStamp,
          capture: performance.now(),
          revBefore: rev(),
          revAfter: -1,
          handlerEnd: -1,
          coalesced: typeof pe.getCoalescedEvents === "function" ? pe.getCoalescedEvents().length : 0,
        });
      },
      { capture: true },
    );
    // Bubble listener on document: runs after the canvas's own (target) listener.
    document.addEventListener(type, () => {
      if (!perf.recording) return;
      const last = perf.inputs[perf.inputs.length - 1];
      if (last && last.handlerEnd < 0) {
        last.handlerEnd = performance.now();
        last.revAfter = rev();
      }
    });
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.longtasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // no long task API
  }
  const watch = new MutationObserver(() => {
    if (perf.welcomeAt < 0 && document.body?.innerText.includes("Tileset'i buraya bırak")) {
      perf.welcomeAt = performance.now();
      watch.disconnect();
    }
  });
  document.addEventListener("DOMContentLoaded", () => watch.observe(document.body, { childList: true, subtree: true, characterData: true }));
}

async function newPage(browser: Browser): Promise<{ page: Page; cdp: CDPSession; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(initScript);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (process.env.PERF_DEBUG) page.on("console", (m) => console.log(`console.${m.type()}: ${m.text()}`)); // PERF_DEBUG=1: page console
  const cdp = await context.newCDPSession(page);
  return {
    page,
    cdp,
    close: async () => {
      await context.close();
      expect(errors).toEqual([]);
    },
  };
}

/** Waits until the main thread has had no long task for `quietMs`; returns the end of the last long task (page ms). */
async function quiet(page: Page, since: number, quietMs = 600): Promise<number> {
  return page.evaluate(
    async ({ since, quietMs }) => {
      const perf = (window as unknown as { __smapPerf: { longtasks: LongTask[] } }).__smapPerf;
      const lastEnd = () => perf.longtasks.reduce((m, l) => (l.start >= since ? Math.max(m, l.start + l.duration) : m), since);
      for (;;) {
        await new Promise((r) => setTimeout(r, 100));
        if (performance.now() - Math.max(lastEnd(), since) >= quietMs) return lastEnd();
      }
    },
    { since, quietMs },
  );
}

async function writeOpfs(page: Page, project: ProjectFiles): Promise<void> {
  for (const [path, content] of project.files) {
    const payload = typeof content === "string" ? { text: content } : { bytes: [...content] };
    await page.evaluate(
      async ({ path, payload }) => {
        let dir = await navigator.storage.getDirectory();
        const parts = path.split("/");
        const name = parts.pop()!;
        for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
        const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await writable.write("text" in payload ? payload.text! : new Uint8Array(payload.bytes!));
        await writable.close();
      },
      { path, payload },
    );
  }
}

async function frames(page: Page): Promise<Frame[]> {
  return page.evaluate(() => (window as unknown as { __smapPerf: { frames: Frame[] } }).__smapPerf.frames);
}

async function resetLog(page: Page, recording: boolean): Promise<void> {
  await page.evaluate((recording) => {
    const perf = (window as unknown as { __smapPerf: { frames: Frame[]; inputs: InputRecord[]; recording: boolean } }).__smapPerf;
    perf.frames.length = 0;
    perf.inputs.length = 0;
    perf.recording = recording;
  }, recording);
}

async function inputs(page: Page): Promise<InputRecord[]> {
  return page.evaluate(() => (window as unknown as { __smapPerf: { inputs: InputRecord[] } }).__smapPerf.inputs);
}

/** Two animation frames (lets pending renders finish). */
async function settle(page: Page, ms = 0): Promise<void> {
  await page.evaluate(
    (ms) => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => r())), ms)),
    ms,
  );
}

async function setCamera(page: Page, cellX: number, cellY: number, zoom: number): Promise<void> {
  // Puts cell (cellX, cellY) in the middle of the canvas.
  await page.evaluate(
    ({ cellX, cellY, zoom }) => {
      const hook = (window as unknown as { __smap: { setCamera(x: number, y: number, z: number): void } }).__smap;
      const canvas = document.querySelector("canvas[data-perf-main]")!;
      const r = canvas.getBoundingClientRect();
      hook.setCamera(r.width / 2 - cellX * 32 * zoom, r.height / 2 - cellY * 32 * zoom, zoom);
    },
    { cellX, cellY, zoom },
  );
  await settle(page, 50);
}

/** Per input that changed the document: event time → end of the first frame that started after its handler. */
function inputLatencies(list: InputRecord[], fr: Frame[]): { latency: number[]; handler: number[]; coalesced: number[]; js: number[]; queue: number[] } {
  const latency: number[] = [];
  const handler: number[] = [];
  const coalesced: number[] = [];
  const js: number[] = [];
  const queue: number[] = [];
  for (const i of list) {
    if (i.handlerEnd < 0 || i.revAfter <= i.revBefore) continue;
    handler.push(i.handlerEnd - i.capture);
    coalesced.push(i.coalesced);
    const f = fr.find((f) => f.start >= i.handlerEnd && f.revision >= i.revAfter);
    queue.push(i.capture - i.t);
    if (!f) continue;
    latency.push(f.end - i.t);
    // CPU work this input costs on the main thread: its handler + the frame that shows it.
    js.push(i.handlerEnd - i.capture + (f.end - f.start));
  }
  return { latency, handler, coalesced, js, queue };
}

/** Event time → end of the first frame showing revision ≥ `rev`. */
function actionLatency(t: number, rev: number, fr: Frame[]): number {
  const f = fr.find((f) => f.start >= t && f.revision >= rev);
  return f ? f.end - t : NaN;
}

function frameStats(fr: Frame[]): { n: number; p50: number; p95: number; max: number; intervalP95: number } {
  const d = fr.map((f) => f.end - f.start);
  const gaps = fr.slice(1).map((f, i) => f.start - fr[i]!.start);
  return { n: fr.length, p50: median(d), p95: percentile(d, 95), max: Math.max(0, ...d), intervalP95: percentile(gaps, 95) };
}

async function startProfile(cdp: CDPSession): Promise<void> {
  if (!PROFILE) return;
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
}

async function stopProfile(cdp: CDPSession, name: string, results: Results): Promise<void> {
  if (!PROFILE) return;
  const { profile } = await cdp.send("Profiler.stop");
  writeFileSync(`${RESULTS}${LABEL}-${name}.cpuprofile`, JSON.stringify(profile));
  results.profiles[name] = summarizeProfile(profile, 15);
}

async function heapMb(cdp: CDPSession): Promise<number> {
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  return usedSize / 1048576;
}

test("editor perf", async ({ browser }) => {
  mkdirSync(RESULTS, { recursive: true });
  const results: Results = { label: LABEL, date: new Date().toISOString(), metrics: {}, profiles: {} };
  const put = (key: string, value: number, unit = "ms") => {
    results.metrics[key] = { value: Math.round(value * 10) / 10, unit };
    console.log(`${key}: ${value.toFixed(1)} ${unit}`);
  };

  // ---------------------------------------------------------------- (a) welcome
  if (want("a")) {
    const fcp: number[] = [];
    const welcome: number[] = [];
    const tti: number[] = [];
    const script: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const { page, close } = await newPage(browser);
      await page.goto("/");
      await expect(page.getByText("Tileset'i buraya bırak")).toBeVisible();
      const lastLong = await quiet(page, 0, 500);
      const m = await page.evaluate(() => {
        const perf = (window as unknown as { __smapPerf: { welcomeAt: number } }).__smapPerf;
        const paint = performance.getEntriesByName("first-contentful-paint")[0];
        const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        // Scripts needed for the welcome screen (later idle preloads excluded).
        const js = res.filter((r) => r.name.endsWith(".js") && r.responseEnd <= perf.welcomeAt).reduce((s, r) => s + r.decodedBodySize, 0);
        return { fcp: paint?.startTime ?? NaN, welcome: perf.welcomeAt, js };
      });
      fcp.push(m.fcp);
      welcome.push(m.welcome);
      tti.push(Math.max(m.welcome, lastLong));
      script.push(m.js / 1024);
      await close();
    }
    put("a.welcome FCP", median(fcp));
    put("a.welcome visible", median(welcome));
    put("a.welcome interactive (no long task)", median(tti));
    put("a.JS loaded before welcome", median(script), "KiB");
  }

  // ---------------------------------------------------------------- (b) open big project
  const t0 = performance.now();
  const big = generateBigProject();
  console.log(`generated big project in ${(performance.now() - t0).toFixed(0)} ms, level ${((big.files.get("levels/main.json") as string).length / 1048576).toFixed(1)} MB`);

  const openRun = async (page: Page, cdp: CDPSession, profileName: string | null) => {
    await page.goto("/");
    await expect(page.getByText("Tileset'i buraya bırak")).toBeVisible();
    await writeOpfs(page, big);
    await quiet(page, 0, 300);
    await resetLog(page, false);
    if (profileName) await startProfile(cdp);
    const clickAt = await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll("button")).find((b) => /Bir proje klasörü seç/.test(b.textContent ?? ""));
      if (!button) throw new Error("open button not found");
      const t = performance.now();
      button.click();
      return t;
    });
    await page.waitForFunction(() => (window as unknown as { __smapPerf: { frames: Frame[] } }).__smapPerf.frames.some((f) => f.scene), undefined, {
      timeout: 120_000,
      polling: 50,
    });
    const lastLong = await quiet(page, clickAt, 800);
    if (profileName) {
      const r = { profiles: {} } as Results;
      await stopProfile(cdp, profileName, r);
      Object.assign(results.profiles, r.profiles);
    }
    const fr = await frames(page);
    const first = fr.find((f) => f.scene)!;
    const longest = await page.evaluate(
      (since) =>
        (window as unknown as { __smapPerf: { longtasks: LongTask[] } }).__smapPerf.longtasks
          .filter((l) => l.start >= since)
          .reduce((m, l) => Math.max(m, l.duration), 0),
      clickAt,
    );
    // Complete: meshes are built in-frame; a far-zoom (LOD) picture fills in over frames.
    const complete = fr.find((f) => f.scene && !(f.lod && f.thumbPending)) ?? fr.at(-1)!;
    return { firstFrame: first.end - clickAt, complete: complete.end - clickAt, firstFrameJs: first.end - first.start, busy: lastLong - clickAt, longest, lod: first.lod };
  };

  if (want("b")) {
    const runs: Awaited<ReturnType<typeof openRun>>[] = [];
    for (let run = 0; run < Math.max(1, Math.min(RUNS, 3)); run++) {
      const { page, cdp, close } = await newPage(browser);
      runs.push(await openRun(page, cdp, run === 0 ? "open" : null));
      await close();
    }
    put("b.open → first map frame", median(runs.map((r) => r.firstFrame)));
    put("b.open → map complete", median(runs.map((r) => r.complete)));
    put("b.first map frame JS", median(runs.map((r) => r.firstFrameJs)));
    console.log(`  first frame LOD: ${runs[0]!.lod}`);
    put("b.open → main thread quiet", median(runs.map((r) => r.busy)));
    put("b.open longest task", median(runs.map((r) => r.longest)));
  }

  // One page for (c)–(g).
  const { page, cdp, close } = await newPage(browser);
  await openRun(page, cdp, null);
  // The tileset panel's preview canvas shares the label: the map canvas is the largest.
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("canvas[aria-label='map canvas']"));
    const area = (c: Element) => c.getBoundingClientRect().width * c.getBoundingClientRect().height;
    all.sort((a, b) => area(b) - area(a))[0]!.setAttribute("data-perf-main", "");
  });
  const canvas = page.locator("canvas[data-perf-main]");
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const heapOpen = await heapMb(cdp);

  // ---------------------------------------------------------------- (d) pan / zoom
  for (const zoom of want("d") ? [1, 0.5, 0.25, 0.125, 0.09, 0.03] : []) {
    await setCamera(page, 300, 300, zoom);
    await page.mouse.move(cx - 400, cy - 200);
    await settle(page, 100);
    await resetLog(page, false);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(cx + 400, cy + 200, { steps: 60 });
    await page.mouse.up({ button: "middle" });
    await settle(page, 50);
    const fr = await frames(page);
    const s = frameStats(fr);
    put(`d.pan @${zoom * 100}%${fr.some((f) => f.lod) ? " (LOD)" : ""} frame p95`, s.p95);
    put(`d.pan @${zoom * 100}% frame max`, s.max);
  }
  if (want("d")) {
    await setCamera(page, 512, 512, 1);
    await page.mouse.move(cx, cy);
    await settle(page, 100);
    await resetLog(page, false);
    await startProfile(cdp);
    for (let i = 0; i < 24; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(16);
    }
    for (let i = 0; i < 24; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(16);
    }
    await settle(page, 400);
    await stopProfile(cdp, "zoom", results);
    const s = frameStats(await frames(page));
    put("d.wheel zoom 100%→far→100% frame p95", s.p95);
    put("d.wheel zoom frame max", s.max);
  }

  // ---------------------------------------------------------------- (c) brush
  await page.evaluate(() => {
    const hook = (window as unknown as { __smap: { editor: { getState(): Record<string, (...a: unknown[]) => void> } } }).__smap;
    const s = hook.editor.getState();
    s.setTool!("brush");
    s.setSelection!({ tilesetId: "overworld", tileId: 9 });
  });
  for (const zoom of want("c") ? [1, 0.25] : []) {
    await setCamera(page, 512, 512, zoom);
    const strokes: { latency: number[]; handler: number[]; coalesced: number[]; js: number[]; queue: number[] } = { latency: [], handler: [], coalesced: [], js: [], queue: [] };
    const fr: Frame[] = [];
    if (zoom === 1) await startProfile(cdp);
    for (const [steps, dx] of [
      [80, 480],
      [12, 480],
    ] as const) {
      for (let k = 0; k < 3; k++) {
        await page.mouse.move(cx - dx, cy - 250 + k * 60);
        await settle(page, 30);
        await resetLog(page, true);
        await page.mouse.down();
        await page.mouse.move(cx + dx, cy - 150 + k * 60, { steps });
        await page.mouse.move(cx - dx / 2, cy + 200 - k * 40, { steps });
        await page.mouse.up();
        await settle(page, 30);
        const rawInputs = await inputs(page);
        const l = inputLatencies(rawInputs, await frames(page));
        strokes.latency.push(...l.latency);
        strokes.handler.push(...l.handler);
        strokes.coalesced.push(...l.coalesced);
        strokes.js.push(...l.js);
        strokes.queue.push(...l.queue);
        fr.push(...(await frames(page)));
      }
    }
    if (zoom === 1) await stopProfile(cdp, "brush", results);
    await resetLog(page, false);
    const s = frameStats(fr.filter((f) => f.end - f.start >= 0));
    put(`c.brush @${zoom * 100}% JS per input (handler+frame) p50`, median(strokes.js));
    put(`c.brush @${zoom * 100}% JS per input (handler+frame) p95`, percentile(strokes.js, 95));
    put(`c.brush @${zoom * 100}% input dispatch delay p50`, median(strokes.queue));
    put(`c.brush @${zoom * 100}% input→frame p50`, median(strokes.latency));
    put(`c.brush @${zoom * 100}% input→frame p95`, percentile(strokes.latency, 95));
    put(`c.brush @${zoom * 100}% handler p95`, percentile(strokes.handler, 95));
    put(`c.brush @${zoom * 100}% frame JS p95`, s.p95);
    put(`c.brush @${zoom * 100}% frame JS max`, s.max);
    console.log(`  brush @${zoom}: ${strokes.latency.length} painting events, coalesced max ${Math.max(0, ...strokes.coalesced)}`);
  }
  // Let the autosave of the strokes run now, not during (e).
  await page.waitForTimeout(2500);
  await quiet(page, 0, 800);

  // ---------------------------------------------------------------- (e) fill + undo
  if (want("e")) {
    await page.evaluate(() => {
      const hook = (window as unknown as {
        __smap: { store: { dispatch(op: unknown): string }; editor: { getState(): Record<string, (...a: unknown[]) => void> } };
      }).__smap;
      const id = hook.store.dispatch({ type: "addLayer", layer: { name: "fill" } });
      const s = hook.editor.getState();
      s.setActiveLayer!(id);
      s.setTool!("fill");
    });
    await setCamera(page, 512, 512, 0.25);
    await page.mouse.move(cx, cy);
    await settle(page, 50);
    await resetLog(page, true);
    await startProfile(cdp);
    await page.mouse.down();
    await page.mouse.up();
    const fillRev = await page.waitForFunction(
      () => {
        const p = (window as unknown as { __smapPerf: { frames: Frame[]; inputs: InputRecord[] } }).__smapPerf;
        const down = p.inputs.find((i) => i.type === "pointerdown");
        return down && down.revAfter > down.revBefore && p.frames.some((f) => f.revision >= down.revAfter) ? down : null;
      },
      undefined,
      { timeout: 60_000, polling: 50 },
    );
    const down = (await fillRev.jsonValue())!;
    put("e.fill 1024² → frame", actionLatency(down.t, down.revAfter, await frames(page)));
    put("e.fill handler", down.handlerEnd - down.capture);
    await settle(page, 100);
    await resetLog(page, true);
    const before = await page.evaluate(() => (window as unknown as { __smap: { store: { revision: number } } }).__smap.store.revision);
    await canvas.focus();
    await page.keyboard.press("Control+z");
    await page.waitForFunction(
      (before) => (window as unknown as { __smapPerf: { frames: Frame[] } }).__smapPerf.frames.some((f) => f.revision > before),
      before,
      { timeout: 60_000, polling: 50 },
    );
    await stopProfile(cdp, "fill-undo", results);
    const key = (await inputs(page)).find((i) => i.type === "keydown" && i.revBefore === before)!;
    put("e.undo fill → frame", actionLatency(key.t, before + 1, await frames(page)));
  }

  // ---------------------------------------------------------------- (g) save
  if (want("g")) {
    // Wait out a running autosave, then make one edit so there is something to save.
    await expect(page.locator("[aria-label='Tüm değişiklikler kaydedildi']")).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => {
      const hook = (window as unknown as { __smap: { store: { document: { layers: { id: string }[] }; dispatch(op: unknown): unknown } } }).__smap;
      const layerId = hook.store.document.layers[0]!.id;
      hook.store.dispatch({ type: "paintCells", layerId, cells: [{ x: 1, y: 1, cell: 1 }] });
    });
    await expect(page.locator("[aria-label='Tüm değişiklikler kaydedildi']")).toBeHidden();
    await startProfile(cdp);
    const t = await page.evaluate(() => performance.now());
    await page.keyboard.press("Control+s");
    const handle = await page.waitForFunction(
      () => (document.querySelector("[aria-label='Tüm değişiklikler kaydedildi']") ? performance.now() : 0),
      undefined,
      { timeout: 60_000, polling: 10 },
    );
    const savedAt = (await handle.jsonValue()) as number;
    await stopProfile(cdp, "save", results);
    put("g.save (Ctrl+S → saved)", savedAt - t);
    const longest = await page.evaluate(
      (since) =>
        (window as unknown as { __smapPerf: { longtasks: LongTask[] } }).__smapPerf.longtasks
          .filter((l) => l.start >= since)
          .reduce((m, l) => Math.max(m, l.duration), 0),
      t,
    );
    put("g.save longest task", longest);
  }

  // ---------------------------------------------------------------- (f) memory
  put("f.JS heap after open", heapOpen, "MB");
  put("f.JS heap after b–g", await heapMb(cdp), "MB");
  await close();

  writeFileSync(`${RESULTS}${LABEL}.json`, `${JSON.stringify(results, null, 2)}\n`);
  let base: Results | null = null;
  try {
    base = JSON.parse(readFileSync(`${RESULTS}baseline.json`, "utf8")) as Results;
  } catch {
    // no baseline yet
  }
  console.log(`\n${formatTable(results, base)}`);
});
