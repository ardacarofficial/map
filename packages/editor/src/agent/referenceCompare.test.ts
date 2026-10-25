import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, encodeRgbaPng, makeCell, MapStore, type RgbaImage } from "@smap/core";
import type { AgentCallContext, AgentWorldPort } from "@smap/agent";
import { clearTilesetImages, setTilesetImage } from "../state/tilesetImages";
import { clearAgentWorld, resetAgentWorld } from "./editGate";
import { clearReferences, createReferencePort } from "./referenceLibrary";
import { clearDraftBaseline } from "./draftBaseline";
import { decodeWorkingSourcePng } from "../io/sourcePng";
import { heatColor, meanDeltaE, over, toLab } from "./referenceCompare";

const T = 4;
const tileset = { id: "art", name: "Art", imagePath: "tilesets/art.png", tileWidth: T, tileHeight: T, columns: 3, rows: 1, margin: 0, spacing: 0 };
/** Tile 0 green with a dark dot, tile 1 brown with a light stripe, tile 2 blue water. */
function atlas(): RgbaImage {
  const data = new Uint8Array(3 * T * T * 4);
  for (let y = 0; y < T; y++) for (let x = 0; x < 3 * T; x++) {
    const tile = Math.floor(x / T), p = (y * 3 * T + x) * 4;
    const base = tile === 2 ? [40, 90, 200] : tile === 1 ? (y === 1 ? [200, 160, 120] : [140, 100, 60]) : (x === 1 && y === 1 ? [20, 60, 20] : [80, 170, 70]);
    data.set([...base, 255], p);
  }
  return { width: 3 * T, height: T, data };
}
const call: AgentCallContext = { clientSessionId: "c", clientInfo: { name: "T", version: "1" }, bridgeEpoch: "e", deadline: Date.now() + 60000, signal: { aborted: false, throwIfAborted() {}, onAbort: () => () => {} } };
/** Map 6×3 drawn as rows of tiles; `layout[y][x]` = tile id. */
const LAYOUT = [[0, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1], [0, 0, 2, 2, 0, 0]];
function setup() {
  const art = atlas();
  setTilesetImage({ tilesetId: "art", bytes: encodeRgbaPng(art.width, art.height, new Uint8Array(art.data)), bitmap: { width: art.width, height: art.height, close: vi.fn() } as unknown as ImageBitmap });
  const store = new MapStore(createDocument({ width: 6, height: 3, tileWidth: T, tileHeight: T, tilesets: [tileset] }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  const world = { tilesets: () => [tileset], stamps: () => [], loadMap: async () => store } as unknown as AgentWorldPort;
  const paint = (layout: number[][]) => store.dispatch({ type: "paintCells", layerId, cells: layout.flatMap((row, y) => row.map((t, x) => ({ x, y, cell: makeCell(store.getOrAddPaletteIndex("art", t), 0) }))) });
  return { art, store, layerId, paint, port: createReferencePort(world, () => 1) };
}
/** Reference picture of LAYOUT at `scale` px per tile px, placed at (ox, oy) on a canvas of the given size (dark background). */
function picture(art: RgbaImage, scale: number, ox = 0, oy = 0, w = 6 * T * scale + ox, h = 3 * T * scale + oy): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([27, 33, 42, 255], i * 4);
  for (let y = 0; y < 3 * T * scale; y++) for (let x = 0; x < 6 * T * scale; x++) {
    const px = ox + x, py = oy + y;
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    const tile = LAYOUT[Math.floor(y / (T * scale))]![Math.floor(x / (T * scale))]!;
    const sx = tile * T + Math.floor(x / scale) % T, sy = Math.floor(y / scale) % T;
    data.set(art.data.subarray((sy * art.width + sx) * 4, (sy * art.width + sx) * 4 + 4), (py * w + px) * 4);
  }
  return encodeRgbaPng(w, h, data);
}
const base64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); };
beforeEach(() => { resetAgentWorld(); clearReferences(); clearDraftBaseline(); });
afterEach(() => { clearTilesetImages(); clearAgentWorld(); });

describe("render_compare region crop", () => {
  it("compares a region against the same cells of the picture, not the whole picture squeezed into it", async () => {
    const { art, port, paint } = setup();
    paint(LAYOUT);
    const ref = await port.add({ imageBase64: base64(picture(art, 3)) }, call);
    const whole = await port.compare({ mapId: "m", referenceId: ref.referenceId, mode: "diff" }, call);
    expect(whole.data.mismatch.cells).toBe(0);
    for (const region of [{ x: 0, y: 1, width: 6, height: 1 }, { x: 2, y: 2, width: 2, height: 1 }, { x: 1, y: 0, width: 3, height: 3 }]) {
      const out = await port.compare({ mapId: "m", referenceId: ref.referenceId, mode: "diff", region }, call);
      expect(out.data.region).toEqual(region);
      expect(out.data.mismatch.cells, JSON.stringify(region)).toBe(0);
    }
  });

  it("maps the region through an explicit alignment (offset, scale, cropped picture)", async () => {
    const { art, port, paint } = setup();
    paint(LAYOUT);
    // Picture at ×2 shifted 5,3 px right/down and cropped on the right: cells x=5 fall off the picture.
    const ref = await port.add({ imageBase64: base64(picture(art, 2, 5, 3, 5 + 5 * T * 2, 3 + 3 * T * 2)) }, call);
    const alignment = { cellPx: 2 * T, scale: 2, offsetX: 5, offsetY: 3, cols: 5, rows: 3, confidence: 1, method: "manual" as const };
    const out = await port.compare({ mapId: "m", referenceId: ref.referenceId, mode: "diff", alignment, region: { x: 2, y: 1, width: 4, height: 2 }, cells: true }, call);
    expect(out.data.mismatch.cells).toBe(0);
    expect(out.data.alignment).toEqual(alignment);
    expect(out.data.stats).toEqual({ cells: 6, meanErr: 0, pctBelow: { deltaE5: 100 } });
    expect(out.data.worst).toEqual([]);
  });
  it("cells:true ranks wrong cells, lists current tiles and better alternatives, and adds a heatmap panel", async () => {
    const { art, port, paint } = setup();
    paint([[0, 0, 0, 0, 0, 0], [1, 1, 0, 1, 1, 1], [0, 0, 2, 0, 0, 0]]);
    const ref = await port.add({ imageBase64: base64(picture(art, 3)) }, call);
    const out = await port.compare({ mapId: "m", referenceId: ref.referenceId, cells: true }, call);
    expect(out.data.stats!.cells).toBe(18);
    expect(out.data.stats!.pctBelow.deltaE5).toBeCloseTo(100 * 16 / 18, 1);
    const worst = out.data.worst!;
    expect(worst.map(w => [w.x, w.y]).sort()).toEqual([[2, 1], [3, 2]]);
    for (const w of worst) {
      expect(w.err).toBeGreaterThan(5);
      expect(w.current).toEqual([{ layerId: expect.any(String), tile: { tilesetId: "art", tileId: 0 } }]);
      expect(w.alternatives[0]).toEqual({ tile: { tilesetId: "art", tileId: LAYOUT[w.y]![w.x]! }, err: 0 });
    }
    const png = decodeWorkingSourcePng(out.image!.png);
    expect(png.width).toBe(out.image!.width);
    const rect = out.data.heatmap!.rect;
    expect(rect.x + rect.width).toBe(png.width);
    // A good cell is green, a wrong one red in the heatmap panel.
    const at = (x: number, y: number) => { const p = (y * png.width + x) * 4; return [png.data[p]!, png.data[p + 1]!, png.data[p + 2]!]; };
    const { contentRect, cellSize } = out.data.image;
    const centre = (cx: number, cy: number) => at(rect.x + contentRect.x + Math.floor((cx + 0.5) * cellSize.width), contentRect.y + Math.floor((cy + 0.5) * cellSize.height));
    const good = centre(0, 0), bad = centre(3, 2);
    expect(good[1]!, JSON.stringify({ good, rect, contentRect, cellSize })).toBeGreaterThan(good[0]!);
    expect(bad[0]!).toBeGreaterThan(bad[1]!);
  });
  it("cells:true normalizes light: a lit picture of the right tiles has no worst cells, wrong tiles still rank", async () => {
    const { art, port, paint } = setup();
    const lit = decodeWorkingSourcePng(picture(art, 3));
    // Warm glow over the right half: brighter and redder.
    for (let y = 0; y < lit.height; y++) for (let x = lit.width / 2; x < lit.width; x++) {
      const p = (y * lit.width + x) * 4;
      lit.data[p] = Math.min(255, Math.round(lit.data[p]! * 1.35)); lit.data[p + 1] = Math.min(255, Math.round(lit.data[p + 1]! * 1.2)); lit.data[p + 2] = Math.min(255, Math.round(lit.data[p + 2]! * 1.1));
    }
    const ref = await port.add({ imageBase64: base64(encodeRgbaPng(lit.width, lit.height, new Uint8Array(lit.data))) }, call);
    paint(LAYOUT);
    const right = await port.compare({ mapId: "m", referenceId: ref.referenceId, cells: true, alignment: "none" }, call);
    expect(right.data.worst).toEqual([]);
    expect(right.data.stats!.pctBelow.deltaE5).toBe(100);
    paint([[0, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1], [0, 0, 2, 2, 1, 0]]);
    const wrong = await port.compare({ mapId: "m", referenceId: ref.referenceId, cells: true, alignment: "none" }, call);
    expect(wrong.data.worst!.map(w => [w.x, w.y])).toEqual([[4, 2]]);
    expect(wrong.data.worst![0]!.alternatives[0]!.tile).toEqual({ tilesetId: "art", tileId: 0 });
  });
  it("reference_view crops the region from the whole-map picture", async () => {
    const { art, port } = setup();
    const ref = await port.add({ imageBase64: base64(picture(art, 3)) }, call);
    const view = await port.view({ referenceId: ref.referenceId, mapId: "m", region: { x: 2, y: 2, width: 2, height: 1 }, grid: false, coordinates: false }, call);
    const png = decodeWorkingSourcePng(view.image!.png);
    const p = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
    expect([...png.data.slice(p, p + 3)]).toEqual([40, 90, 200]);
    expect(view.data.cellPixels).toEqual({ width: 12, height: 12 });
  });
});

describe("compare helpers", () => {
  it("scores identical pixels as 0 ΔE, composites overlays and colours the heatmap from green to red", () => {
    const red = new Uint8Array([200, 30, 30, 255]), half = new Uint8Array([0, 0, 255, 128]);
    expect(meanDeltaE(toLab(red, 1), toLab(red, 1))).toBe(0);
    expect([...over(red, half)]).toEqual([100, 15, 143, 255]);
    expect(heatColor(0)[1]).toBeGreaterThan(heatColor(0)[0]);
    expect(heatColor(25)).toEqual([226, 84, 84, 255]);
  });
});
