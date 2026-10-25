/** World-scoped reference pictures (picture → map). Added by the user (drop, paste, file picker) or by the
 * agent (reference_add). Decoded once in memory; never written to the project, disk or history. */
import {
  AGENT_LIMITS, AgentError, AgentErrorCode, REFERENCE_LIMITS, autoTrim, detectStampProbes, encodeLayer, looksLikeSketch, quantizeReference, referencePlacement, summarizeConfidence, tileKey,
  type AgentCallContext, type AgentReferencePort, type AgentWorldPort, type ReferenceAlignmentChoice, type CellResult, type PreviewImage, type ProposalCell, type QuantizeCandidate, type QuantizeLayerProposal,
  type QuantizeOutput, type Rect, type ReferenceAlignment, type ReferenceFit, type ReferenceSummary, type RenderCompareData, type StampProbe, type ColorLegendEntry, parseHexColor,
} from "@smap/agent";
import { BUILTIN_ENTITY_TYPES, createDocument, makeCell, MapStore, tileRect, type MapDocument, type RgbaImage } from "@smap/core";
import { decodeWorkingSourcePng } from "../io/sourcePng";
import { getAgentWorldSessionId } from "./editGate";
import { encodeAgentPng, imagePixels } from "./images";
import { drawPreviewOverlays, previewLayout, renderPreviewPixelsAsync, type PreviewLayout } from "./preview";
import { RasterReplay } from "./raster";
import { imageWork } from "./imageWork";
import { changedCells, draftStartDocument, noteLastCall } from "./draftBaseline";
import { resolveSelectedReference } from "./selectedReference";
import { cellHeightPx, detectAlignment, pictureContent } from "./match/alignment";
import { quantizeAligned } from "./match/quantize";
import { buildTileIndex, type TileIndex } from "./match/tileIndex";

interface StoredReference extends ReferenceSummary { pixels: RgbaImage; world: string | null }
const references = new Map<string, StoredReference>();
/** K1: saved grid alignments per (referenceId, mapId); memory only, gone with the reference. */
const alignments = new Map<string, ReferenceAlignment>();
const alignmentKey = (referenceId: string, mapId: string) => `${referenceId}\u0000${mapId}`;
const forgetAlignments = (referenceId?: string) => { for (const key of [...alignments.keys()]) if (referenceId === undefined || key.startsWith(`${referenceId}\u0000`)) alignments.delete(key); };
export function getAlignment(referenceId: string, mapId: string): ReferenceAlignment | undefined { prune(); return alignments.get(alignmentKey(referenceId, mapId)); }
export function setAlignment(referenceId: string, mapId: string, alignment: ReferenceAlignment | null): void {
  if (alignment) alignments.set(alignmentKey(referenceId, mapId), alignment); else alignments.delete(alignmentKey(referenceId, mapId));
}
const listeners = new Set<() => void>();
let sequence = 0;
let localReader: ((path: string) => Promise<Uint8Array>) | null = null;
const emit = () => { for (const listener of listeners) listener(); };
const fail = (code: AgentErrorCode, message: string, details: Record<string, string | number | boolean> = {}): never => { throw new AgentError(code, message, details); };

/** The transport supplies a reader for agent-given local paths (desktop command / dev server). */
export function setLocalImageReader(reader: ((path: string) => Promise<Uint8Array>) | null): void { localReader = reader; }
export function subscribeReferences(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
function prune(): void {
  const world = getAgentWorldSessionId();
  let changed = false;
  for (const [id, r] of references) if (r.world !== world) { references.delete(id); forgetAlignments(id); changed = true; }
  if (changed) emit();
}
let snapshot: ReferenceSummary[] = [];
let snapshotKey = "";
/** Stable list for React (same array until something changes). */
export function listReferences(): ReferenceSummary[] {
  prune();
  const list = [...references.values()].map(({ referenceId, name, width, height, origin }) => ({ referenceId, name, width, height, origin }));
  const key = JSON.stringify(list);
  if (key !== snapshotKey) { snapshotKey = key; snapshot = list; }
  return snapshot;
}
export function removeReference(referenceId: string): void { forgetAlignments(referenceId); if (references.delete(referenceId)) emit(); }
export function clearReferences(): void { forgetAlignments(); if (references.size) { references.clear(); emit(); } }
export function referencePixels(referenceId: string): RgbaImage | undefined { prune(); return references.get(referenceId)?.pixels; }

type ImageKind = "png" | "jpeg" | "webp";
function sniff(bytes: Uint8Array): ImageKind | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length > 16 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "webp";
  return null;
}
/** Declared dimensions from the header, before any decoder allocates pixels. */
export function declaredSize(bytes: Uint8Array, kind: ImageKind): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (kind === "png") return bytes.length >= 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : null;
  if (kind === "webp") {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === "VP8X" && bytes.length >= 30) return { width: 1 + (bytes[24]! | bytes[25]! << 8 | bytes[26]! << 16), height: 1 + (bytes[27]! | bytes[28]! << 8 | bytes[29]! << 16) };
    if (chunk === "VP8L" && bytes.length >= 25) { const b = view.getUint32(21, true); return { width: 1 + (b & 0x3fff), height: 1 + (b >> 14 & 0x3fff) }; }
    if (chunk === "VP8 " && bytes.length >= 30) return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    return null;
  }
  for (let p = 2; p + 9 < bytes.length;) {
    if (bytes[p] !== 0xff) return null;
    const marker = bytes[p + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { p += 2; continue; }
    const length = view.getUint16(p + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: view.getUint16(p + 5), width: view.getUint16(p + 7) };
    p += 2 + length;
  }
  return null;
}
/** Fit inside the reference budget: 2048 per side and 4M pixels. */
function fitted(width: number, height: number): { width: number; height: number } {
  const k = Math.min(1, REFERENCE_LIMITS.side / width, REFERENCE_LIMITS.side / height, Math.sqrt(REFERENCE_LIMITS.pixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * k)), height: Math.max(1, Math.floor(height * k)) };
}
function boxDownscale(image: RgbaImage, width: number, height: number): RgbaImage {
  if (width === image.width && height === image.height) return image;
  const out = new Uint8Array(width * height * 4), sx = image.width / width, sy = image.height / height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)), y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    const sum = [0, 0, 0, 0];
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const p = (yy * image.width + xx) * 4; for (let c = 0; c < 4; c++) sum[c]! += image.data[p + c]!; }
    const n = (x1 - x0) * (y1 - y0), q = (y * width + x) * 4;
    for (let c = 0; c < 4; c++) out[q + c] = Math.round(sum[c]! / n);
  }
  return { width, height, data: out };
}
/** PNG/JPEG/WebP → RGBA within the reference budget. Browser decoders do the work; PNG has a pure fallback. */
export async function decodeReferenceImage(bytes: Uint8Array): Promise<RgbaImage> {
  if (bytes.length > REFERENCE_LIMITS.fileBytes) fail(AgentErrorCode.LIMIT_EXCEEDED, "Reference image is larger than 16 MB", { cause: "fileTooLarge" });
  const kind = sniff(bytes);
  if (!kind) return fail(AgentErrorCode.INVALID_ARGUMENT, "Reference must be a PNG, JPEG or WebP image", { cause: "unsupportedType" });
  const size = declaredSize(bytes, kind);
  if (!size || !size.width || !size.height || size.width > 16384 || size.height > 16384 || size.width * size.height > 64 * 1024 * 1024)
    fail(AgentErrorCode.LIMIT_EXCEEDED, "Reference image dimensions are invalid or exceed 16384 px / 64 megapixels", { cause: "dimensions" });
  const target = fitted(size!.width, size!.height);
  if (typeof createImageBitmap === "function" && typeof OffscreenCanvas === "function") {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: `image/${kind}` }), { resizeWidth: target.width, resizeHeight: target.height, resizeQuality: "high" });
    } catch { return fail(AgentErrorCode.INVALID_ARGUMENT, "The image could not be decoded", { cause: "decodeFailed" }); }
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext("2d");
      if (!context) return fail(AgentErrorCode.EDITOR_UNAVAILABLE, "Image decoding is unavailable");
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      return { width: bitmap.width, height: bitmap.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
    } finally { bitmap.close(); }
  }
  if (kind !== "png") return fail(AgentErrorCode.EDITOR_UNAVAILABLE, "This host can only decode PNG references");
  let decoded: RgbaImage;
  try { decoded = decodeWorkingSourcePng(bytes); } catch { return fail(AgentErrorCode.INVALID_ARGUMENT, "The image could not be decoded", { cause: "decodeFailed" }); }
  return boxDownscale(decoded, target.width, target.height);
}
function store(pixels: RgbaImage, name: string, origin: "user" | "agent"): ReferenceSummary {
  prune();
  if (references.size >= REFERENCE_LIMITS.references) fail(AgentErrorCode.LIMIT_EXCEEDED, "At most 32 reference images per world; remove one first", { cause: "tooManyReferences" });
  const retained = [...references.values()].reduce((n, r) => n + r.pixels.data.byteLength, 0);
  if (retained + pixels.data.byteLength > REFERENCE_LIMITS.retainedBytes) fail(AgentErrorCode.LIMIT_EXCEEDED, "Reference images exceed the 64 MiB budget; remove one first", { cause: "memory" });
  let visible = false;
  for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i]) { visible = true; break; }
  if (!visible) fail(AgentErrorCode.INVALID_ARGUMENT, "Reference image is fully transparent");
  const referenceId = `ref-${++sequence}`;
  const entry: StoredReference = { referenceId, name: name.slice(0, 128) || referenceId, width: pixels.width, height: pixels.height, origin, pixels, world: getAgentWorldSessionId() };
  references.set(referenceId, entry);
  emit();
  return { referenceId, name: entry.name, width: entry.width, height: entry.height, origin };
}
/** UI intake: dropped/pasted/picked files. */
export async function addUserReference(file: Blob, name: string): Promise<ReferenceSummary> {
  if (file.size > REFERENCE_LIMITS.fileBytes) fail(AgentErrorCode.LIMIT_EXCEEDED, "Reference image is larger than 16 MB", { cause: "fileTooLarge" });
  return store(await decodeReferenceImage(new Uint8Array(await file.arrayBuffer())), name, "user");
}
const baseName = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");

interface Mapping { pixels: RgbaImage; sourceRect: Rect; placement: Rect; fit: ReferenceFit }
function mapping(referenceId: string, region: Rect, fit: ReferenceFit | undefined, sourceRect: Rect | undefined, tileWidth: number, tileHeight: number): Mapping {
  const pixels = referencePixels(referenceId) ?? fail(AgentErrorCode.UNKNOWN_ID, "Unknown referenceId");
  const rect = sourceRect ?? autoTrim(pixels);
  if (rect.x + rect.width > pixels.width || rect.y + rect.height > pixels.height) fail(AgentErrorCode.OUT_OF_BOUNDS, "sourceRect lies outside the picture", { width: pixels.width, height: pixels.height });
  const f = fit ?? "stretch";
  return { pixels, sourceRect: rect, fit: f, placement: referencePlacement(rect, region, f, tileWidth / tileHeight) };
}
/** Picture drawn onto a preview layout's content rectangle, nearest neighbour. */
function drawReference(canvas: RasterReplay, layout: PreviewLayout, m: Mapping, alpha = 1): void {
  canvas.globalAlpha = alpha;
  canvas.drawImage(m.pixels as unknown as CanvasImageSource, m.sourceRect.x, m.sourceRect.y, m.sourceRect.width, m.sourceRect.height,
    layout.left + m.placement.x * layout.cw, layout.top + m.placement.y * layout.ch, m.placement.width * layout.cw, m.placement.height * layout.ch);
  canvas.globalAlpha = 1;
}
const metadata = (layout: PreviewLayout, region: Rect, tileWidth: number, tileHeight: number, grid: boolean, coordinates: boolean): PreviewImage => ({
  width: layout.width, height: layout.height, scale: layout.scale, pixelOrigin: { x: region.x * tileWidth, y: region.y * tileHeight },
  cellSize: { width: layout.cw, height: layout.ch }, contentRect: layout.contentRect, grid, coordinates,
});
/** Mean colour and a 4×4 structure patch of one cell of an RGBA image. */
function cellFeature(image: RgbaImage, x0: number, y0: number, w: number, h: number): Float32Array {
  const out = new Float32Array(16 * 3), counts = new Float32Array(16);
  const mx = w * 0.1, my = h * 0.1, ax = Math.floor(x0 + mx), ay = Math.floor(y0 + my), bx = Math.max(ax + 1, Math.ceil(x0 + w - mx)), by = Math.max(ay + 1, Math.ceil(y0 + h - my));
  const step = Math.max(1, Math.floor(Math.min(bx - ax, by - ay) / 16));
  for (let y = ay; y < by && y < image.height; y += step) for (let x = ax; x < bx && x < image.width; x += step) {
    const p = (y * image.width + x) * 4, a = image.data[p + 3]! / 255;
    const k = Math.min(3, Math.floor((y - ay) / (by - ay) * 4)) * 4 + Math.min(3, Math.floor((x - ax) / (bx - ax) * 4));
    for (let c = 0; c < 3; c++) out[k * 3 + c]! += image.data[p + c]! * a;
    counts[k]!++;
  }
  for (let k = 0; k < 16; k++) for (let c = 0; c < 3; c++) out[k * 3 + c] = counts[k] ? out[k * 3 + c]! / counts[k]! : 0;
  return out;
}
function featureDistance(a: Float32Array, b: Float32Array, meanOnly: boolean): number {
  if (meanOnly) {
    const ma = [0, 0, 0], mb = [0, 0, 0];
    for (let k = 0; k < 16; k++) for (let c = 0; c < 3; c++) { ma[c]! += a[k * 3 + c]! / 16; mb[c]! += b[k * 3 + c]! / 16; }
    return Math.hypot(ma[0]! - mb[0]!, ma[1]! - mb[1]!, ma[2]! - mb[2]!);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(sum / a.length);
}
function compose(images: RgbaImage[], gap: number): RgbaImage {
  const width = images.reduce((n, i) => n + i.width, 0) + gap * (images.length - 1), height = Math.max(...images.map(i => i.height));
  const canvas = new RasterReplay(width, height);
  canvas.fill({ x: 0, y: 0, width, height }, [11, 18, 23, 255]);
  let x = 0;
  for (const image of images) { canvas.drawImage(image as unknown as CanvasImageSource, 0, 0, image.width, image.height, x, 0, image.width, image.height); x += image.width + gap; }
  return canvas;
}

/** Detected alignments below this confidence fall back to fitting the picture onto the region. */
const AUTO_MIN_CONFIDENCE = 0.35;
/** Matches with a mean error at or below this ΔE count as (near-)exact in stats. */
const EXACTISH_ERR = 6;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The legacy fit (picture stretched/contained onto region) expressed as an alignment. */
function fittedAlignment(m: Mapping, region: Rect, tileWidth: number): ReferenceAlignment {
  const cellPx = m.sourceRect.width / m.placement.width, cellPxY = m.sourceRect.height / m.placement.height;
  return {
    cellPx: r3(cellPx), cellPxY: r3(cellPxY), scale: r3(cellPx / tileWidth),
    offsetX: r3(m.sourceRect.x - (region.x + m.placement.x) * cellPx), offsetY: r3(m.sourceRect.y - (region.y + m.placement.y) * cellPxY),
    cols: Math.ceil(region.x + m.placement.x + m.placement.width), rows: Math.ceil(region.y + m.placement.y + m.placement.height), confidence: 0, method: "manual",
  };
}
/** Picture pixels shown by the region's cells under an alignment (may extend past the picture). */
export function alignedSourceRect(a: ReferenceAlignment, region: Rect, tileWidth: number, tileHeight: number): Rect {
  const ch = cellHeightPx(a, tileWidth, tileHeight);
  return { x: a.offsetX + region.x * a.cellPx, y: a.offsetY + region.y * ch, width: region.width * a.cellPx, height: region.height * ch };
}
const clipRect = (r: Rect, w: number, h: number): Rect => {
  const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
  return { x, y, width: Math.max(0, Math.min(w, Math.round(r.x + r.width)) - x), height: Math.max(0, Math.min(h, Math.round(r.y + r.height)) - y) };
};
/** Candidate tile pixels: explicit tiles, chosen tilesets, or the world's own (non-generated) art. */
async function candidateTiles(world: AgentWorldPort, candidates: { tilesetIds?: string[]; tiles?: { tilesetId: string; tileId: number }[] } | undefined, call: AgentCallContext, cap: boolean): Promise<QuantizeCandidate[]> {
  const all = world.tilesets();
  const chosen = candidates?.tilesetIds ? all.filter(t => candidates.tilesetIds!.includes(t.id))
    : candidates?.tiles ? all.filter(t => candidates.tiles!.some(c => c.tilesetId === t.id))
      : all.filter(t => !t.generated && !t.edited).length ? all.filter(t => !t.generated && !t.edited) : all;
  const out: QuantizeCandidate[] = [];
  for (const tileset of chosen) {
    const pixels = await imagePixels(tileset.id, call.signal), count = tileset.edited?.nextTileId ?? tileset.columns * tileset.rows;
    const wanted = candidates?.tiles ? new Set(candidates.tiles.filter(c => c.tilesetId === tileset.id).map(c => c.tileId)) : null;
    for (let tileId = 0; tileId < count; tileId++) {
      if (wanted && !wanted.has(tileId)) continue;
      const r = tileRect(tileset, tileId);
      if (r.x + r.width > pixels.width || r.y + r.height > pixels.height) continue;
      const data = new Uint8Array(r.width * r.height * 4);
      let visible = false;
      for (let y = 0; y < r.height; y++) data.set(pixels.data.subarray(((r.y + y) * pixels.width + r.x) * 4, ((r.y + y) * pixels.width + r.x + r.width) * 4), y * r.width * 4);
      for (let i = 3; i < data.length; i += 4) if (data[i]) { visible = true; break; }
      if (visible) out.push({ tile: { tilesetId: tileset.id, tileId, flags: 0 }, pixels: { width: r.width, height: r.height, data } });
      if (cap && out.length >= REFERENCE_LIMITS.candidateTiles) return out;
    }
    if (out.length > REFERENCE_LIMITS.candidateTiles) fail(AgentErrorCode.LIMIT_EXCEEDED, "More than 1024 candidate tiles", { nextAction: "Pass candidates.tilesetIds or candidates.tiles to narrow the search." });
  }
  return out;
}
let indexCache: { key: string; index: TileIndex } | null = null;
function tileIndexFor(candidates: readonly QuantizeCandidate[], size: number, revision: number): TileIndex {
  const key = `${revision}|${size}|${candidates.map(c => tileKey(c.tile)).join("|")}`;
  if (indexCache?.key !== key) indexCache = { key, index: buildTileIndex(candidates.map(c => ({ ref: { tilesetId: c.tile.tilesetId, tileId: c.tile.tileId }, rgba: c.pixels.data, w: c.pixels.width, h: c.pixels.height })), { size }) };
  return indexCache.index;
}
/** Sketch quantization of the region's cells that lie on the whole-map fitted picture; other cells stay uncovered. */
async function sketchInRegion(m: Mapping, region: Rect, tileWidth: number, tileHeight: number, run: (sub: { region: Rect; sourceRect: Rect }) => Promise<QuantizeOutput>): Promise<QuantizeOutput> {
  const a = fittedAlignment(m, { x: 0, y: 0, width: Math.ceil(m.placement.x + m.placement.width), height: Math.ceil(m.placement.y + m.placement.height) }, tileWidth);
  const p = m.placement, x0 = Math.max(region.x, Math.ceil(p.x - 0.5)), y0 = Math.max(region.y, Math.ceil(p.y - 0.5));
  const x1 = Math.min(region.x + region.width, Math.ceil(p.x + p.width - 0.5)), y1 = Math.min(region.y + region.height, Math.ceil(p.y + p.height - 0.5));
  const W = region.width, H = region.height;
  const sub = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  if (!sub.width || !sub.height) fail(AgentErrorCode.OUT_OF_BOUNDS, "The region lies outside the picture", { nextAction: "Quantize cells the picture covers (see reference_view), or pass alignment." });
  const src = alignedSourceRect(a, sub, tileWidth, tileHeight);
  const clipped = { x: Math.max(m.sourceRect.x, src.x), y: Math.max(m.sourceRect.y, src.y), width: 0, height: 0 };
  clipped.width = Math.min(m.sourceRect.x + m.sourceRect.width, src.x + src.width) - clipped.x; clipped.height = Math.min(m.sourceRect.y + m.sourceRect.height, src.y + src.height) - clipped.y;
  const out = await run({ region: sub, sourceRect: { x: Math.floor(clipped.x), y: Math.floor(clipped.y), width: Math.max(1, Math.round(clipped.width)), height: Math.max(1, Math.round(clipped.height)) } });
  if (sub.x === region.x && sub.y === region.y && sub.width === W && sub.height === H) return out;
  const pad = (rows: string[]) => Array.from({ length: H }, (_, y) => {
    const row = rows[y + region.y - sub.y];
    return row === undefined ? " ".repeat(W) : " ".repeat(sub.x - region.x) + row + " ".repeat(region.x + W - sub.x - sub.width);
  });
  const cells: CellResult[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x + region.x - sub.x, sy = y + region.y - sub.y;
    cells.push(sx >= 0 && sy >= 0 && sx < sub.width && sy < sub.height ? out.cells[sy * sub.width + sx]! : { ground: -1, overlay: -1, error: 0, confidence: 0, legend: -1, covered: false });
  }
  return { ...out, cells, groundRows: pad(out.groundRows), overlayRows: out.overlayRows ? pad(out.overlayRows) : null, confidence: summarizeConfidence(cells, region) };
}

/** The grid a call uses: explicit, saved, detected (fit fallback when unsure) or fitted ("none"). */
interface Grid { alignment: ReferenceAlignment; reported: ReferenceAlignment | null; content: Rect; fit: ReferenceFit; warnings: string[] }

export function createReferencePort(world: AgentWorldPort, revision: () => number): AgentReferencePort {
  async function documentFor(mapId: string): Promise<{ doc: MapDocument; store: MapStore }> {
    const store = await world.loadMap(mapId);
    return { store, doc: store.document };
  }
  async function sources(ids: Iterable<string>, call: AgentCallContext): Promise<Map<string, RgbaImage>> {
    const result = new Map<string, RgbaImage>();
    for (const id of new Set(ids)) try { result.set(id, await imagePixels(id, call.signal)); } catch (error) { call.signal.throwIfAborted(); if (!(error instanceof AgentError)) throw error; }
    return result;
  }
  const usedTilesets = (doc: MapDocument) => new Set(doc.palette.entries().map(e => e.tilesetId));
  async function renderMap(doc: MapDocument, region: Rect, options: { coordinates: boolean; grid: boolean; maxSide?: number; zoom?: number; layerIds?: string[]; highlight?: { cells?: ReadonlySet<number> } }, call: AgentCallContext) {
    const images = await sources(usedTilesets(doc), call);
    const entityNames = new Map<string, string>([...BUILTIN_ENTITY_TYPES, ...doc.entityTypes].map(type => [type.id, type.name]));
    return renderPreviewPixelsAsync(doc, region, { ...options, entityNames, ...(options.highlight ? { highlight: options.highlight } : {}) }, id => images.get(id), call);
  }
  async function resolveGrid(args: { referenceId: string; mapId: string; alignment?: ReferenceAlignmentChoice; fit?: ReferenceFit; sourceRect?: Rect }, doc: MapDocument, region: Rect, call: AgentCallContext, index: () => Promise<TileIndex>): Promise<Grid> {
    const map = doc.map, pixels = referencePixels(args.referenceId) ?? fail(AgentErrorCode.UNKNOWN_ID, "Unknown referenceId");
    const option = args.alignment ?? "auto", warnings: string[] = [];
    // "none" (and the unsure fallback): the picture fitted onto the whole map; a region crops the same cells.
    const whole = { x: 0, y: 0, width: map.width, height: map.height };
    const fitted = (): Grid => { const m = mapping(args.referenceId, whole, args.fit, args.sourceRect, map.tileWidth, map.tileHeight); return { alignment: fittedAlignment(m, whole, map.tileWidth), reported: null, content: m.sourceRect, fit: m.fit, warnings }; };
    if (option === "none") return fitted();
    if (typeof option === "object") {
      const content = pictureContent(pixels), ch = option.cellPxY ?? option.cellPx * map.tileHeight / map.tileWidth;
      const a: ReferenceAlignment = {
        cellPx: option.cellPx, ...(option.cellPxY !== undefined ? { cellPxY: option.cellPxY } : {}), scale: option.scale ?? r3(option.cellPx / map.tileWidth),
        offsetX: option.offsetX, offsetY: option.offsetY,
        cols: option.cols ?? Math.max(0, Math.ceil((content.x + content.width - option.offsetX) / option.cellPx - 0.5)),
        rows: option.rows ?? Math.max(0, Math.ceil((content.y + content.height - option.offsetY) / ch - 0.5)),
        confidence: option.confidence ?? 1, method: option.method ?? "manual",
      };
      return { alignment: a, reported: a, content, fit: "stretch", warnings };
    }
    const saved = getAlignment(args.referenceId, args.mapId);
    if (saved) return { alignment: saved, reported: saved, content: pictureContent(pixels), fit: "stretch", warnings };
    const tiles = await index();
    if (!tiles.ground.length) { warnings.push("No opaque candidate tiles to detect the grid; the picture was fitted onto the whole map."); return fitted(); }
    const detected = await detectAlignment(pixels, { tileWidth: map.tileWidth, tileHeight: map.tileHeight, index: tiles, fit: { region, mapWidth: map.width, mapHeight: map.height }, checkpoint: imageWork(call) });
    if (detected.alignment.confidence < AUTO_MIN_CONFIDENCE) {
      warnings.push(`Grid alignment unsure (confidence ${detected.alignment.confidence}); the picture was fitted onto the whole map. Call reference_align (check its preview, give hint scale/offsetX/offsetY) or pass alignment.`);
      return fitted();
    }
    setAlignment(args.referenceId, args.mapId, detected.alignment);
    return { alignment: detected.alignment, reported: detected.alignment, content: detected.content, fit: "stretch", warnings };
  }
  const worldIndex = (call: AgentCallContext) => async () => tileIndexFor(await candidateTiles(world, undefined, call, true), 16, revision());
  return {
    list: listReferences,
    noteChange: noteLastCall,
    subscribe: subscribeReferences,
    async add(args, call) {
      call.signal.throwIfAborted();
      if (args.selectedReferenceToken !== undefined) {
        const world = getAgentWorldSessionId();
        if (!world) fail(AgentErrorCode.NO_WORLD, "No open world");
        return store(resolveSelectedReference(args.selectedReferenceToken, world!), args.name ?? "Seçim", "agent");
      }
      let bytes: Uint8Array;
      if (args.path !== undefined) {
        if (!localReader) return fail(AgentErrorCode.EDITOR_UNAVAILABLE, "This editor cannot read local files", { nextAction: "Ask the user to drop the picture onto the AI activity panel (Referans ekle), then read get_session.references." });
        if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(args.path)) fail(AgentErrorCode.INVALID_ARGUMENT, "path must be absolute", { cause: "relativePath" });
        try { bytes = await localReader(args.path); } catch (error) {
          call.signal.throwIfAborted();
          const message = error instanceof Error ? error.message : String(error);
          const cause = /not ?found|enoent|no such/i.test(message) ? "notFound" : /large|size/i.test(message) ? "fileTooLarge" : /type|extension/i.test(message) ? "unsupportedType" : "readFailed";
          return fail(cause === "fileTooLarge" ? AgentErrorCode.LIMIT_EXCEEDED : AgentErrorCode.INVALID_ARGUMENT, `Could not read ${args.path}`, { cause, nextAction: cause === "notFound"
            ? "No file exists at this exact path. Compare it segment by segment with your working directory (a '/' written as '-' is a common slip), or ask the user to drop the picture onto the AI activity panel."
            : "Check the absolute path, or ask the user to drop the picture onto the AI activity panel." });
        }
      } else {
        const value = args.imageBase64!.replace(/^data:image\/[a-z]+;base64,/, "");
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4) fail(AgentErrorCode.INVALID_ARGUMENT, "imageBase64 must be base64 file bytes");
        const binary = atob(value);
        bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      }
      call.signal.throwIfAborted();
      const pixels = await decodeReferenceImage(bytes!);
      call.signal.throwIfAborted();
      return store(pixels, args.name ?? (args.path ? baseName(args.path) : `Referans ${sequence + 1}`), "agent");
    },
    async view(args, call) {
      const { doc } = await documentFor(args.mapId), map = doc.map;
      const region = args.region ?? { x: 0, y: 0, width: map.width, height: map.height };
      const pixels = referencePixels(args.referenceId) ?? fail(AgentErrorCode.UNKNOWN_ID, "Unknown referenceId");
      const grid = await resolveGrid(args, doc, region, call, worldIndex(call));
      const source = alignedSourceRect(grid.alignment, region, map.tileWidth, map.tileHeight);
      const gridLines = args.grid ?? true, coordinates = args.coordinates ?? true;
      const layout = previewLayout(region, map.tileWidth, map.tileHeight, { coordinates, ...(args.maxSide ? { maxSide: args.maxSide } : {}), ...(args.zoom ? { zoom: args.zoom } : {}) });
      const canvas = new RasterReplay(layout.width, layout.height, layout.contentRect);
      canvas.fill({ x: 0, y: 0, width: layout.width, height: layout.height }, [27, 33, 42, 255]); canvas.checker(layout.contentRect);
      canvas.drawImage(pixels as unknown as CanvasImageSource, source.x, source.y, source.width, source.height, layout.left, layout.top, region.width * layout.cw, region.height * layout.ch);
      const overlays = new RasterReplay(layout.width, layout.height);
      overlays.data.set(canvas.data);
      drawPreviewOverlays(overlays, layout, region, { grid: gridLines, coordinates });
      call.signal.throwIfAborted();
      const ch = cellHeightPx(grid.alignment, map.tileWidth, map.tileHeight);
      return {
        data: { mapId: args.mapId, referenceId: args.referenceId, region, fit: grid.fit, sourceRect: clipRect(source, pixels.width, pixels.height), cellPixels: { width: +grid.alignment.cellPx.toFixed(2), height: +ch.toFixed(2) }, alignment: grid.reported, ...(grid.warnings.length ? { warnings: grid.warnings } : {}), image: metadata(layout, region, map.tileWidth, map.tileHeight, gridLines, coordinates) },
        image: { png: encodeAgentPng(overlays), width: layout.width, height: layout.height, revision: revision(), warnings: [] },
      };
    },
    async align(args, call) {
      const { doc } = await documentFor(args.mapId), map = doc.map;
      const pixels = referencePixels(args.referenceId) ?? fail(AgentErrorCode.UNKNOWN_ID, "Unknown referenceId");
      const index = await worldIndex(call)();
      if (!index.ground.length) fail(AgentErrorCode.INVALID_ARGUMENT, "No opaque tiles to align against", { nextAction: "Import the tileset the picture was made from, then call reference_align again." });
      const region = { x: 0, y: 0, width: map.width, height: map.height };
      const detected = await detectAlignment(pixels, { tileWidth: map.tileWidth, tileHeight: map.tileHeight, index, ...(args.hint ? { hint: args.hint } : {}), fit: { region, mapWidth: map.width, mapHeight: map.height }, checkpoint: imageWork(call) });
      const a = detected.alignment, warnings: string[] = [];
      if (a.confidence < AUTO_MIN_CONFIDENCE) warnings.push("Low confidence: check the grid in the preview; give hint.scale (or cellPx) and offsetX/offsetY of a cell corner you can see.");
      if (a.cols < map.width || a.rows < map.height) warnings.push(`The picture covers ${a.cols}×${a.rows} cells from cell (0,0); the map is ${map.width}×${map.height}.`);
      const saved = args.save !== false;
      if (saved) setAlignment(args.referenceId, args.mapId, a);
      // Preview: the picture with the detected grid; cell (0,0) outlined, every 8th line brighter.
      const maxSide = args.maxSide ?? 1024, side = Math.max(pixels.width, pixels.height);
      const k = side > maxSide ? maxSide / side : Math.max(1, Math.floor(maxSide / side));
      const W = Math.max(1, Math.round(pixels.width * k)), H = Math.max(1, Math.round(pixels.height * k));
      const canvas = new RasterReplay(W, H);
      canvas.drawImage(pixels as unknown as CanvasImageSource, 0, 0, pixels.width, pixels.height, 0, 0, W, H);
      const ch = cellHeightPx(a, map.tileWidth, map.tileHeight), every = a.cellPx * k < 4 ? 8 : 1;
      for (let i = Math.ceil(-a.offsetX / a.cellPx); a.offsetX + i * a.cellPx <= pixels.width; i++) {
        if (i % every) continue;
        const x = Math.round((a.offsetX + i * a.cellPx) * k), major = i % 8 === 0;
        canvas.fill({ x, y: 0, width: major ? 2 : 1, height: H }, major ? [105, 201, 174, 230] : [105, 201, 174, 120]);
        if (major && x + 4 < W) canvas.label(String(i), x + 3, 3, 2);
      }
      for (let j = Math.ceil(-a.offsetY / ch); a.offsetY + j * ch <= pixels.height; j++) {
        if (j % every) continue;
        const y = Math.round((a.offsetY + j * ch) * k), major = j % 8 === 0;
        canvas.fill({ x: 0, y, width: W, height: major ? 2 : 1 }, major ? [105, 201, 174, 230] : [105, 201, 174, 120]);
        if (major && j && y + 4 < H) canvas.label(String(j), 3, y + 3, 2);
      }
      canvas.outline({ x: Math.round(a.offsetX * k), y: Math.round(a.offsetY * k), width: Math.max(3, Math.round(a.cellPx * k)), height: Math.max(3, Math.round(ch * k)) }, [240, 112, 122, 255], 2);
      call.signal.throwIfAborted();
      return {
        data: { mapId: args.mapId, referenceId: args.referenceId, alignment: a, saved, content: detected.content, image: { width: W, height: H, scale: r3(k) }, warnings },
        image: { png: encodeAgentPng(canvas), width: W, height: H, revision: revision(), warnings: [] },
      };
    },
    async quantize(args, call) {
      const { doc, store: mapStore } = await documentFor(args.mapId), map = doc.map, mapRevision = mapStore.revision;
      const region = args.region!;
      // The picture lies on the whole map; a region crops the same cells (never squeezes the picture into it).
      const m = mapping(args.referenceId, { x: 0, y: 0, width: map.width, height: map.height }, args.fit, args.sourceRect, map.tileWidth, map.tileHeight);
      const mode = !args.mode || args.mode === "auto" ? (looksLikeSketch(m.pixels, m.sourceRect) ? "sketch" : "render") : args.mode;
      const warnings: string[] = [];
      const candidates = await candidateTiles(world, args.candidates, call, false);
      if (!candidates.length) fail(AgentErrorCode.INVALID_ARGUMENT, "No visible candidate tiles", { nextAction: "Check candidates; tilesets need loaded artwork." });
      const legend: ColorLegendEntry[] = args.legend.map(entry => ({ rgb: parseHexColor(entry.hex)!, label: entry.label, ...(entry.cell !== undefined ? { cell: entry.cell } : {}), ...(entry.overlay !== undefined ? { overlay: entry.overlay } : {}), ...(entry.stampId ? { stampId: entry.stampId } : {}) }));
      if (mode === "render" && legend.length) warnings.push("colorLegend is used only in sketch mode");
      if (legend.some(l => l.overlay) && !args.overlayLayer) warnings.push("colorLegend overlay tiles need an overlay layer; they were left out");
      const probes: StampProbe[] = args.probes.map(p => ({ stampId: p.stampId, width: p.width, height: p.height, cells: p.cells }));
      const checkpoint = imageWork(call);
      let out: QuantizeOutput, grid: Grid | null = null, stats: { exactish: number; meanErr: number } | undefined;
      if (mode === "sketch") {
        if (args.alignment && args.alignment !== "auto" && args.alignment !== "none") warnings.push("Sketch mode maps colours with fit/sourceRect; alignment was ignored");
        out = await sketchInRegion(m, region, map.tileWidth, map.tileHeight, sub => quantizeReference({ reference: m.pixels, sourceRect: sub.sourceRect, region: sub.region, fit: "stretch", mode, candidates, overlay: false, colorLegend: legend, stamps: probes, checkpoint }));
      } else {
        const index = tileIndexFor(candidates, region.width * region.height > 16384 ? 8 : 16, revision());
        grid = await resolveGrid(args, doc, region, call, async () => index);
        warnings.push(...grid.warnings);
        const matches = await quantizeAligned({ reference: m.pixels, alignment: grid.alignment, content: grid.content, region, index, tileWidth: map.tileWidth, tileHeight: map.tileHeight, normalizeLight: args.normalizeLight ?? true, layered: true, checkpoint });
        const byKey = new Map(candidates.map((c, i) => [`${c.tile.tilesetId}\u0000${c.tile.tileId}`, i]));
        const candidateOf = (i: number) => i < 0 ? -1 : byKey.get(`${index.tiles[i]!.ref.tilesetId}\u0000${index.tiles[i]!.ref.tileId}`) ?? -1;
        const cellJson = (i: number): ProposalCell => ({ tilesetId: candidates[i]!.tile.tilesetId, tileId: candidates[i]!.tile.tileId });
        const cells: CellResult[] = [], groundValues: (ProposalCell | undefined)[] = [], overlayValues: (ProposalCell | undefined)[] = [];
        let overlayCells = 0, exact = 0, errSum = 0, covered = 0;
        for (const cell of matches) {
          const mt = cell.match;
          if (!cell.covered || !mt || !mt.ground) { cells.push({ ground: -1, overlay: -1, error: 0, confidence: 0, legend: -1, covered: false }); groundValues.push(undefined); overlayValues.push(undefined); continue; }
          const g = candidateOf(mt.groundIndex), o = candidateOf(mt.overlayIndex);
          if (o >= 0) overlayCells++;
          const useOverlay = o >= 0 && !!args.overlayLayer;
          cells.push({ ground: g, overlay: useOverlay ? o : -1, error: mt.err, confidence: mt.confidence, legend: -1, covered: true });
          groundValues.push(g >= 0 ? cellJson(g) : undefined); overlayValues.push(useOverlay ? cellJson(o) : undefined);
          covered++; errSum += mt.err; if (mt.err <= EXACTISH_ERR) exact++;
        }
        if (overlayCells && !args.overlayLayer) warnings.push(`${overlayCells} cells show a transparent overlay tile, but the map has no second visible tile layer; create one with edit_layer (or pass layers.overlay) and call again.`);
        const ground = encodeLayer(region.width, region.height, groundValues), overlay = encodeLayer(region.width, region.height, overlayValues);
        const topKeys = cells.map(c => c.overlay >= 0 ? tileKey(candidates[c.overlay]!.tile) : c.ground >= 0 ? tileKey(candidates[c.ground]!.tile) : "");
        const ch = cellHeightPx(grid.alignment, map.tileWidth, map.tileHeight);
        out = {
          cells, groundRows: ground.rows, groundLegend: ground.legend,
          overlayRows: args.overlayLayer ? overlay.rows : null, overlayLegend: overlay.legend,
          counts: { ground: ground.counts, overlay: overlay.counts }, confidence: summarizeConfidence(cells, region),
          stamps: probes.length ? detectStampProbes(region, topKeys, probes) : [], palette: [],
          cellPixels: { width: +grid.alignment.cellPx.toFixed(2), height: +ch.toFixed(2) }, placement: { x: 0, y: 0, width: region.width, height: region.height },
        };
        stats = { exactish: covered ? Math.round(exact / covered * 1000) / 10 : 0, meanErr: covered ? Math.round(errSum / covered * 10) / 10 : 0 };
      }
      if (mapStore.revision !== mapRevision) fail(AgentErrorCode.REVISION_CONFLICT, "Map changed during quantization", { nextAction: "Call reference_quantize again." });
      const layers: QuantizeLayerProposal[] = [{ layerId: args.groundLayer.id, layerName: args.groundLayer.name, origin: { x: region.x, y: region.y }, rows: out.groundRows, legend: out.groundLegend, counts: out.counts.ground }];
      if (args.overlayLayer && out.overlayRows && out.overlayRows.some(row => row.trim())) layers.push({ layerId: args.overlayLayer.id, layerName: args.overlayLayer.name, origin: { x: region.x, y: region.y }, rows: out.overlayRows, legend: out.overlayLegend, counts: out.counts.overlay });
      const stampNames = new Map(args.probes.map(p => [p.stampId, p.name]));
      const sourceRect = grid ? clipRect(alignedSourceRect(grid.alignment, region, map.tileWidth, map.tileHeight), m.pixels.width, m.pixels.height) : m.sourceRect;
      const data = {
        mapId: args.mapId, referenceId: args.referenceId, region, mode, fit: grid ? grid.fit : m.fit, sourceRect, cellPixels: out.cellPixels,
        ...(grid ? { alignment: grid.reported } : {}), ...(stats ? { stats } : {}),
        grid: { layers }, confidence: out.confidence,
        stamps: out.stamps.map(s => ({ ...s, name: stampNames.get(s.stampId) ?? s.stampId })),
        ...(mode === "sketch" ? { palette: out.palette } : {}),
        warnings, mapRevision,
      };
      if (args.preview === false) return { data };
      // Preview: the proposal as it would look once painted, low-confidence cells outlined.
      const preview = new MapStore(createDocument({ width: map.width, height: map.height, tileWidth: map.tileWidth, tileHeight: map.tileHeight, tilesets: world.tilesets() }), { historyLimit: 0 });
      const paintRows = (rows: string[], legendMap: Record<string, unknown>) => {
        const layerId = preview.dispatch({ type: "addLayer", layer: { name: "proposal" } });
        const cells: { x: number; y: number; cell: number }[] = [];
        rows.forEach((row, y) => [...row].forEach((ch, x) => {
          const value = legendMap[ch] as { tilesetId: string; tileId: number; flags?: number } | null | "keep" | undefined;
          if (!value || value === "keep") return;
          cells.push({ x: region.x + x, y: region.y + y, cell: makeCell(preview.getOrAddPaletteIndex(value.tilesetId, value.tileId), 0) });
        }));
        for (let i = 0; i < cells.length; i += AGENT_LIMITS.cellsPerCall) preview.dispatch({ type: "paintCells", layerId, cells: cells.slice(i, i + AGENT_LIMITS.cellsPerCall) });
      };
      for (const layer of layers) paintRows(layer.rows, layer.legend);
      if (out.stamps.some(s => s.source === "legend")) {
        const layerId = preview.dispatch({ type: "addLayer", layer: { name: "stamps" } });
        const cells: { x: number; y: number; cell: number }[] = [];
        for (const s of out.stamps) if (s.source === "legend") for (const c of probes.find(p => p.stampId === s.stampId)?.cells ?? []) {
          const x = s.at.x + c.x, y = s.at.y + c.y;
          if (x < map.width && y < map.height) cells.push({ x, y, cell: makeCell(preview.getOrAddPaletteIndex(c.tile.tilesetId, c.tile.tileId), 0) });
        }
        for (let i = 0; i < cells.length; i += AGENT_LIMITS.cellsPerCall) preview.dispatch({ type: "paintCells", layerId, cells: cells.slice(i, i + AGENT_LIMITS.cellsPerCall) });
      }
      const low = new Set<number>();
      out.cells.forEach((c, i) => { if (c.covered && c.confidence < 0.3) low.add(i); });
      const rendered = await renderMap(preview.document, region, { coordinates: true, grid: true, highlight: { cells: low } }, call);
      return { data: { ...data, image: rendered.image }, image: { png: encodeAgentPng(rendered), width: rendered.width, height: rendered.height, revision: revision(), warnings: [] } };
    },
    async compare(args, call) {
      const { doc, store: mapStore } = await documentFor(args.mapId), map = doc.map, mapRevision = mapStore.revision;
      const region = args.region ?? { x: 0, y: 0, width: map.width, height: map.height };
      const mode = args.mode ?? "side";
      // Side by side stays within the 1568 px clients show unscaled.
      const maxSide = Math.min(args.maxSide ?? 1536, mode === "side" ? 752 : 2048);
      const before = args.baseline ? draftStartDocument(args.mapId, doc) : undefined;
      if (args.baseline && !before) fail(AgentErrorCode.INVALID_ARGUMENT, "This map has no draft start in the pending edit", { nextAction: "Compare a map that your pending edit includes." });
      const layerIds = args.layerIds;
      const options = { coordinates: true, maxSide, ...(layerIds ? { layerIds } : {}) };
      const plain = await renderMap(doc, region, { ...options, grid: false }, call);
      const layout = previewLayout(region, map.tileWidth, map.tileHeight, { coordinates: true, maxSide });
      const m = args.referenceId ? mapping(args.referenceId, region, args.fit, args.sourceRect, map.tileWidth, map.tileHeight) : undefined;
      // Mismatching cells: exact identity against the draft start, appearance against a picture.
      const mismatch = new Set<number>();
      if (before) for (const i of changedCells(before, doc, region)) mismatch.add(i);
      else if (m) {
        const sketch = looksLikeSketch(m.pixels, m.sourceRect);
        const pxX = m.sourceRect.width / m.placement.width, pxY = m.sourceRect.height / m.placement.height;
        const checkpoint = imageWork(call);
        for (let y = 0; y < region.height; y++) {
          const pause = checkpoint(); if (pause) await pause;
          for (let x = 0; x < region.width; x++) {
            const lx = x - m.placement.x, ly = y - m.placement.y;
            if (lx + 0.5 < 0 || ly + 0.5 < 0 || lx + 0.5 > m.placement.width || ly + 0.5 > m.placement.height) continue;
            const a = cellFeature(m.pixels, m.sourceRect.x + lx * pxX, m.sourceRect.y + ly * pxY, pxX, pxY);
            const b = cellFeature(plain, layout.left + x * layout.cw, layout.top + y * layout.ch, layout.cw, layout.ch);
            if (featureDistance(a, b, sketch) > (sketch ? 56 : 36)) mismatch.add(y * region.width + x);
          }
        }
      }
      const sample = [...mismatch].slice(0, 32).map(i => ({ x: region.x + i % region.width, y: region.y + Math.floor(i / region.width) }));
      const withOverlays = (base: RgbaImage) => { const c = new RasterReplay(base.width, base.height); c.data.set(base.data); drawPreviewOverlays(c, layout, region, { grid: true, coordinates: true }); return c; };
      let picture: RgbaImage;
      if (mode === "diff") {
        const canvas = withOverlays(plain);
        canvas.fill(layout.contentRect, [11, 18, 23, 130]);
        for (const i of mismatch) {
          const x = i % region.width, y = Math.floor(i / region.width);
          const cell = { x: layout.left + Math.floor(x * layout.cw), y: layout.top + Math.floor(y * layout.ch), width: Math.max(1, Math.ceil(layout.cw)), height: Math.max(1, Math.ceil(layout.ch)) };
          canvas.fill(cell, [240, 112, 122, 90]);
          if (layout.cw >= 6) canvas.outline(cell, [240, 112, 122, 255], layout.cw >= 24 ? 2 : 1);
        }
        picture = canvas;
      } else {
        let base: RgbaImage;
        if (m) {
          const left = new RasterReplay(plain.width, plain.height, layout.contentRect);
          left.fill({ x: 0, y: 0, width: plain.width, height: plain.height }, [27, 33, 42, 255]); left.checker(layout.contentRect);
          drawReference(left, layout, m);
          base = left;
        } else base = await renderMap(before!, region, { ...options, grid: false }, call);
        if (mode === "overlay") {
          const blended = new RasterReplay(base.width, base.height, layout.contentRect);
          blended.data.set(base.data);
          blended.globalAlpha = 0.5;
          blended.drawImage(plain as unknown as CanvasImageSource, 0, 0, plain.width, plain.height, 0, 0, plain.width, plain.height);
          picture = withOverlays(blended);
        } else picture = compose([withOverlays(base), withOverlays(plain)], 8);
      }
      call.signal.throwIfAborted();
      if (mapStore.revision !== mapRevision) fail(AgentErrorCode.REVISION_CONFLICT, "Map changed during comparison");
      const image: PreviewImage = { ...metadata(layout, region, map.tileWidth, map.tileHeight, true, true), width: picture.width, height: picture.height };
      const data: RenderCompareData = { mapId: args.mapId, region, mode, against: m ? "reference" : "draftStart", image, mismatch: { cells: mismatch.size, ratio: +(mismatch.size / (region.width * region.height)).toFixed(4), sample }, mapRevision };
      return { data, image: { png: encodeAgentPng(picture), width: picture.width, height: picture.height, revision: revision(), warnings: [] } };
    },
  };
}
