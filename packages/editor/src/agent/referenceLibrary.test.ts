import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, encodeRgbaPng, makeCell, MapStore, type RgbaImage } from "@smap/core";
import type { AgentCallContext, AgentWorldPort, ReferenceQuantizeRequest } from "@smap/agent";
import { clearTilesetImages, setTilesetImage } from "../state/tilesetImages";
import { decodeWorkingSourcePng } from "../io/sourcePng";
import { clearAgentWorld, resetAgentWorld } from "./editGate";
import { clearReferences, createReferencePort, declaredSize, decodeReferenceImage, getAlignment, listReferences, removeReference, setLocalImageReader, subscribeReferences } from "./referenceLibrary";
import { previewLayout, renderPreviewPixels } from "./preview";
import { captureDraftStart, changedCells, clearDraftBaseline, draftStartDocument } from "./draftBaseline";

const T = 4;
const tileset = { id: "art", name: "Art", imagePath: "tilesets/art.png", tileWidth: T, tileHeight: T, columns: 2, rows: 1, margin: 0, spacing: 0 };
/** Tile 0: green with a dark dot, tile 1: brown with a light stripe. */
function atlas(): RgbaImage {
  const data = new Uint8Array(2 * T * T * 4);
  for (let y = 0; y < T; y++) for (let x = 0; x < 2 * T; x++) {
    const p = (y * 2 * T + x) * 4, second = x >= T;
    const base = second ? (y === 1 ? [200, 160, 120] : [140, 100, 60]) : (x === 1 && y === 1 ? [20, 60, 20] : [80, 170, 70]);
    data.set([...base, 255], p);
  }
  return { width: 2 * T, height: T, data };
}
const call: AgentCallContext = { clientSessionId: "c", clientInfo: { name: "T", version: "1" }, bridgeEpoch: "e", deadline: Date.now() + 60000, signal: { aborted: false, throwIfAborted() {}, onAbort: () => () => {} } };
function setup() {
  const art = atlas();
  setTilesetImage({ tilesetId: "art", bytes: encodeRgbaPng(art.width, art.height, new Uint8Array(art.data)), bitmap: { width: art.width, height: art.height, close: vi.fn() } as unknown as ImageBitmap });
  const store = new MapStore(createDocument({ width: 6, height: 3, tileWidth: T, tileHeight: T, tilesets: [tileset] }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  const world = { tilesets: () => [tileset], stamps: () => [], loadMap: async () => store } as unknown as AgentWorldPort;
  return { art, store, layerId, port: createReferencePort(world, () => 1) };
}
/** The reference: a 6×3 map (tile 1 in the middle row) drawn at 3× with a dark 10 px gutter. */
function referencePng(art: RgbaImage): Uint8Array {
  const scale = 3, gutter = 10, w = gutter + 6 * T * scale, h = gutter + 3 * T * scale, data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([27, 33, 42, 255], i * 4);
  for (let y = 0; y < 3 * T * scale; y++) for (let x = 0; x < 6 * T * scale; x++) {
    const cy = Math.floor(y / (T * scale)), tile = cy === 1 ? 1 : 0;
    const sx = tile * T + Math.floor(x / scale) % T, sy = Math.floor(y / scale) % T;
    data.set(art.data.subarray((sy * art.width + sx) * 4, (sy * art.width + sx) * 4 + 4), ((gutter + y) * w + gutter + x) * 4);
  }
  return encodeRgbaPng(w, h, data);
}
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
beforeEach(() => { resetAgentWorld(); clearReferences(); clearDraftBaseline(); });
afterEach(() => { clearTilesetImages(); setLocalImageReader(null); clearAgentWorld(); });

describe("reference library", () => {
  it("reads declared sizes of PNG, JPEG and WebP headers before decoding", () => {
    const png = encodeRgbaPng(3, 2, new Uint8Array(24));
    expect(declaredSize(png, "png")).toEqual({ width: 3, height: 2 });
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 3, 0, 0, 0);
    expect(declaredSize(jpeg, "jpeg")).toEqual({ width: 30, height: 20 });
    const webp = new Uint8Array(30); webp.set([...new TextEncoder().encode("RIFF")], 0); webp.set([...new TextEncoder().encode("WEBPVP8X")], 8); webp.set([99, 0, 0, 49, 0, 0], 24);
    expect(declaredSize(webp, "webp")).toEqual({ width: 100, height: 50 });
  });
  it("downscales big pictures and rejects other formats", async () => {
    const big = await decodeReferenceImage(encodeRgbaPng(4096, 8, new Uint8Array(4096 * 8 * 4).fill(255)));
    expect([big.width, big.height]).toEqual([2048, 4]);
    await expect(decodeReferenceImage(new TextEncoder().encode("GIF89a........"))).rejects.toMatchObject({ code: "INVALID_ARGUMENT", details: { cause: "unsupportedType" } });
  });
  it("adds agent pictures by path or base64, lists them per world and never keeps another world's", async () => {
    const { art, port } = setup();
    const seen = vi.fn(), off = subscribeReferences(seen);
    await expect(port.add({ path: "/home/u/köy.png" }, call)).rejects.toMatchObject({ code: "EDITOR_UNAVAILABLE" });
    setLocalImageReader(async path => { if (path !== "/home/u/köy.png") throw Error("not found"); return referencePng(art); });
    expect(await port.add({ path: "/home/u/köy.png" }, call)).toMatchObject({ name: "köy", width: 82, height: 46, origin: "agent" });
    await expect(port.add({ path: "relative.png" }, call)).rejects.toMatchObject({ details: { cause: "relativePath" } });
    await expect(port.add({ path: "/missing.png" }, call)).rejects.toMatchObject({ details: { cause: "notFound" } });
    const second = await port.add({ imageBase64: base64(referencePng(art)), name: "B" }, call);
    expect(listReferences().map(r => r.name)).toEqual(["köy", "B"]);
    removeReference(second.referenceId);
    expect(listReferences()).toHaveLength(1);
    expect(seen).toHaveBeenCalled();
    resetAgentWorld();
    expect(listReferences()).toEqual([]);
    off();
  });
  it("quantizes a gutter-framed render into a paint_grid proposal with a preview", async () => {
    const { art, port, layerId } = setup();
    const reference = await port.add({ imageBase64: base64(referencePng(art)) }, call);
    const request: ReferenceQuantizeRequest = { referenceId: reference.referenceId, mapId: "m", region: { x: 0, y: 0, width: 6, height: 3 }, legend: [], probes: [], groundLayer: { id: layerId, name: "Zemin" }, overlayLayer: null };
    const out = await port.quantize(request, call);
    expect(out.data.sourceRect).toEqual({ x: 10, y: 10, width: 72, height: 36 });
    expect(out.data.mode).toBe("render");
    expect(out.data.grid.layers).toEqual([{ layerId, layerName: "Zemin", origin: { x: 0, y: 0 }, rows: ["aaaaaa", "bbbbbb", "aaaaaa"], legend: { a: { tilesetId: "art", tileId: 0 }, b: { tilesetId: "art", tileId: 1 } }, counts: { a: 12, b: 6 } }]);
    expect(out.data.confidence).toMatchObject({ low: 0, uncovered: 0 });
    const preview = decodeWorkingSourcePng(out.image!.png);
    expect(preview.width).toBe(out.data.image!.width);
  });
  it("aligns the picture on the grid; a region quantizes the same cells, never the squeezed picture", async () => {
    const { art, port, layerId } = setup();
    const reference = await port.add({ imageBase64: base64(referencePng(art)) }, call);
    const aligned = await port.align!({ referenceId: reference.referenceId, mapId: "m" }, call);
    expect(aligned.data.alignment).toMatchObject({ cellPx: 12, scale: 3, offsetX: 10, offsetY: 10, cols: 6, rows: 3, method: "auto" });
    expect(aligned.data.alignment.confidence).toBeGreaterThan(0.5);
    expect(aligned.data.saved).toBe(true);
    expect(getAlignment(reference.referenceId, "m")).toEqual(aligned.data.alignment);
    expect(decodeWorkingSourcePng(aligned.image!.png).width).toBe(aligned.data.image.width);
    const decode = (layer: { rows: string[]; legend: Record<string, unknown> }) => layer.rows.map(row => [...row].map(ch => (layer.legend[ch] as { tileId: number }).tileId));
    for (const alignment of ["auto", "none"] as const) {
      const request: ReferenceQuantizeRequest = { referenceId: reference.referenceId, mapId: "m", region: { x: 2, y: 1, width: 3, height: 2 }, alignment, legend: [], probes: [], groundLayer: { id: layerId, name: "Zemin" }, overlayLayer: null, preview: false };
      const out = await port.quantize(request, call);
      expect(decode(out.data.grid.layers[0]!), alignment).toEqual([[1, 1, 1], [0, 0, 0]]);
      expect(out.data.sourceRect, alignment).toEqual({ x: 34, y: 22, width: 36, height: 24 });
    }
    const auto = await port.quantize({ referenceId: reference.referenceId, mapId: "m", region: { x: 0, y: 0, width: 6, height: 3 }, legend: [], probes: [], groundLayer: { id: layerId, name: "Zemin" }, overlayLayer: null, preview: false }, call);
    expect(auto.data.alignment).toMatchObject({ cellPx: 12 });
    expect(auto.data.stats).toEqual({ exactish: 100, meanErr: 0 });
    const view = await port.view({ referenceId: reference.referenceId, mapId: "m", region: { x: 2, y: 1, width: 3, height: 2 } }, call);
    expect(view.data).toMatchObject({ sourceRect: { x: 34, y: 22, width: 36, height: 24 }, cellPixels: { width: 12, height: 12 } });
    const manual = await port.align!({ referenceId: reference.referenceId, mapId: "m", hint: { scale: 3, offsetX: -2, offsetY: 10 }, save: false }, call);
    expect(manual.data.alignment).toMatchObject({ cellPx: 12, offsetX: -2, method: "manual", cols: 7 });
    expect(getAlignment(reference.referenceId, "m")).toEqual(aligned.data.alignment);
    removeReference(reference.referenceId);
    expect(getAlignment(reference.referenceId, "m")).toBeUndefined();
  });
  it("views and compares on the render_preview grid; draft compare marks changed cells", async () => {
    const { art, port, store, layerId } = setup();
    const reference = await port.add({ imageBase64: base64(referencePng(art)) }, call);
    const view = await port.view({ referenceId: reference.referenceId, mapId: "m" }, call);
    const layout = previewLayout({ x: 0, y: 0, width: 6, height: 3 }, T, T, { coordinates: true });
    expect(view.data.image.contentRect).toEqual(layout.contentRect);
    expect(view.data.cellPixels).toEqual({ width: 12, height: 12 });
    const empty = await port.compare({ mapId: "m", referenceId: reference.referenceId, mode: "diff" }, call);
    expect(empty.data.mismatch.cells).toBe(18);
    captureDraftStart("m", store);
    const grass = store.getOrAddPaletteIndex("art", 0), dirt = store.getOrAddPaletteIndex("art", 1);
    store.dispatch({ type: "paintCells", layerId, cells: Array.from({ length: 18 }, (_, i) => ({ x: i % 6, y: Math.floor(i / 6), cell: makeCell(Math.floor(i / 6) === 1 ? dirt : grass, 0) })) });
    const painted = await port.compare({ mapId: "m", referenceId: reference.referenceId, mode: "side" }, call);
    expect(painted.data.mismatch.cells).toBe(0);
    expect(painted.image!.width).toBeGreaterThan(2 * layout.contentRect.width);
    const draft = await port.compare({ mapId: "m", baseline: "draftStart", mode: "overlay" }, call);
    expect(draft.data).toMatchObject({ against: "draftStart", mismatch: { cells: 18 } });
    expect(changedCells(draftStartDocument("m", store.document)!, store.document, { x: 0, y: 0, width: 6, height: 3 }).size).toBe(18);
  });
});

describe("preview layout", () => {
  it("uses whole pixels per cell: zoom for crops, whole shrink for large maps", () => {
    expect(previewLayout({ x: 0, y: 0, width: 8, height: 8 }, 32, 32, { zoom: 4 }).cw).toBe(128);
    expect(previewLayout({ x: 0, y: 0, width: 8, height: 8 }, 32, 32, { zoom: 8, maxSide: 1024 }).cw).toBe(128);
    const big = previewLayout({ x: 0, y: 0, width: 100, height: 60 }, 32, 32, { coordinates: true });
    expect(Number.isInteger(big.cw)).toBe(true);
    expect(big.cw).toBe(15);
    const village = previewLayout({ x: 0, y: 0, width: 48, height: 32 }, 32, 32, { coordinates: true });
    expect([village.cw, village.width, village.height]).toEqual([32, 1560, 1040]);
  });
  it("outlines highlighted cells and labels entity cells", () => {
    const store = new MapStore(createDocument({ width: 4, height: 4, tileWidth: 8, tileHeight: 8 }));
    const layerId = store.dispatch({ type: "addLayer", layer: { name: "E", type: "entity" } });
    store.dispatch({ type: "addEntity", layerId, entity: { typeId: "spawn", x: 8, y: 8, fields: {} } });
    const plain = renderPreviewPixels(store.document, { x: 0, y: 0, width: 4, height: 4 }, { zoom: 4 }, () => undefined);
    const marked = renderPreviewPixels(store.document, { x: 0, y: 0, width: 4, height: 4 }, { zoom: 4, highlight: { cells: new Set([0]) } }, () => undefined);
    const at = (img: RgbaImage, x: number, y: number) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
    expect(at(marked, 0, 0)).not.toEqual(at(plain, 0, 0));
    expect(at(plain, 32, 32)).toEqual([105, 201, 174, 255]);
  });
});
