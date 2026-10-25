/** World-scoped reference pictures (picture → map). Added by the user (drop, paste, file picker) or by the
 * agent (reference_add). Decoded once in memory; never written to the project, disk or history. */
import {
  AGENT_LIMITS, AgentError, AgentErrorCode, REFERENCE_LIMITS, autoTrim, looksLikeSketch, quantizeReference, referencePlacement,
  type AgentCallContext, type AgentReferencePort, type AgentWorldPort, type PreviewImage, type QuantizeCandidate, type QuantizeLayerProposal,
  type CompareWorstCell, type Rect, type ReferenceFit, type ReferenceSummary, type RenderCompareData, type Tile, type StampProbe, type ColorLegendEntry, parseHexColor,
} from "@smap/agent";
import { BUILTIN_ENTITY_TYPES, cellFlags, cellPaletteIndex, createDocument, FLIP_D, FLIP_H, FLIP_V, isTileLayer, makeCell, MapStore, tileRect, type MapDocument, type RgbaImage } from "@smap/core";
import { decodeWorkingSourcePng } from "../io/sourcePng";
import { getAgentWorldSessionId } from "./editGate";
import { encodeAgentPng, imagePixels } from "./images";
import { drawPreviewOverlays, previewLayout, renderPreviewPixelsAsync, type PreviewLayout } from "./preview";
import { RasterReplay, textWidth } from "./raster";
import { regionCompositeSteps } from "../export/pngComposite";
import { candidate, cellCovered, cellSource, heatColor, meanDeltaE, rankAlternatives, referenceFrame, regionPlacement, samplePatch, toLab, type CompareCandidate, type ReferenceFrame } from "./referenceCompare";
import { imageWork } from "./imageWork";
import { changedCells, draftStartDocument, noteLastCall } from "./draftBaseline";
import { resolveSelectedReference } from "./selectedReference";

/** Worst cells listed by render_compare cells:true. */
const COMPARE_WORST = 12;
interface StoredReference extends ReferenceSummary { pixels: RgbaImage; world: string | null }
const references = new Map<string, StoredReference>();
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
  for (const [id, r] of references) if (r.world !== world) { references.delete(id); changed = true; }
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
export function removeReference(referenceId: string): void { if (references.delete(referenceId)) emit(); }
export function clearReferences(): void { if (references.size) { references.clear(); emit(); } }
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
  /** Per-cell mean Lab ΔE between the native-size map render and the picture, plus the worst cells with local alternatives. */
  async function cellErrors(doc: MapDocument, region: Rect, frame: ReferenceFrame, pixels: RgbaImage, layerIds: readonly string[] | undefined, call: AgentCallContext) {
    const map = doc.map, tw = map.tileWidth, th = map.tileHeight, n = tw * th;
    const images = await sources(usedTilesets(doc), call);
    const checkpoint = imageWork(call);
    const errors = new Float32Array(region.width * region.height).fill(-1);
    const refLabs = new Map<number, Float32Array>();
    const band = Math.max(1, Math.floor(1048576 / (region.width * n)));
    for (let by = 0; by < region.height; by += band) {
      const rows = { x: region.x, y: region.y + by, width: region.width, height: Math.min(band, region.height - by) };
      const canvas = new RasterReplay(rows.width * tw, rows.height * th), ox = rows.x * tw, oy = rows.y * th;
      for (const op of regionCompositeSteps(doc, rows, 1, layerIds)) {
        if (!op) { const pause = checkpoint(); if (pause) await pause; continue; }
        if (op.kind === "alpha") { canvas.globalAlpha = op.alpha; continue; }
        const source = images.get(op.tilesetId);
        if (!source) continue;
        const [a, b, c, d, e, f] = op.transform;
        canvas.setTransform(a, b, c, d, e - ox, f - oy);
        canvas.drawImage(source as unknown as CanvasImageSource, op.sx, op.sy, op.sw, op.sh, 0, 0, op.dw, op.dh);
      }
      const cell = new Uint8Array(n * 4);
      for (let y = 0; y < rows.height; y++) {
        const pause = checkpoint(); if (pause) await pause;
        for (let x = 0; x < rows.width; x++) {
          const mx = region.x + x, my = rows.y + y;
          if (!cellCovered(frame, mx, my)) continue;
          for (let r = 0; r < th; r++) { const p = ((y * th + r) * canvas.width + x * tw) * 4; cell.set(canvas.data.subarray(p, p + tw * 4), r * tw * 4); }
          const i = (by + y) * region.width + x, refLab = toLab(samplePatch(pixels, cellSource(frame, mx, my), tw, th).data, n);
          refLabs.set(i, refLab);
          errors[i] = meanDeltaE(toLab(cell, n), refLab);
        }
      }
    }
    let covered = 0, sum = 0, good = 0;
    for (const err of errors) if (err >= 0) { covered++; sum += err; if (err < 5) good++; }
    const order = [...errors.keys()].filter(i => errors[i]! >= 5).sort((a, b) => errors[b]! - errors[a]! || a - b).slice(0, COMPARE_WORST);
    const layers = doc.layers.filter(l => isTileLayer(l) && l.visible && l.opacity > 0 && (!layerIds || layerIds.includes(l.id)));
    const current = (x: number, y: number) => layers.flatMap(l => {
      const value = l.getCell(x, y), entry = value ? doc.palette.get(cellPaletteIndex(value)) : undefined;
      if (!entry) return [];
      const raw = cellFlags(value), flags = (raw & FLIP_H ? 1 : 0) | (raw & FLIP_V ? 2 : 0) | (raw & FLIP_D ? 4 : 0);
      const tile: Tile = flags ? { tilesetId: entry.tilesetId, tileId: entry.tileId, flags: flags as NonNullable<Tile["flags"]> } : { tilesetId: entry.tilesetId, tileId: entry.tileId };
      return [{ layerId: l.id, tile }];
    });
    const candidates = order.length ? await compareCandidates(doc, call) : [];
    const worst: CompareWorstCell[] = [];
    for (const i of order) {
      const pause = checkpoint(); if (pause) await pause;
      const x = region.x + i % region.width, y = region.y + Math.floor(i / region.width), now = current(x, y);
      const bottom = now[0] && !now[0].tile.flags ? candidates.find(c => c.tile.tilesetId === now[0]!.tile.tilesetId && c.tile.tileId === now[0]!.tile.tileId && c.opaque) : undefined;
      worst.push({ x, y, err: Math.round(errors[i]! * 10) / 10, current: now, alternatives: rankAlternatives(refLabs.get(i)!, candidates, errors[i]!, bottom) });
    }
    return { errors, worst, stats: { cells: covered, meanErr: covered ? Math.round(sum / covered * 10) / 10 : 0, pctBelow: { deltaE5: covered ? Math.round(good / covered * 1000) / 10 : 0 } } };
  }
  /** Map-size tiles of the map's own tilesets first, then the world's non-generated art (≤ 1024 visible tiles). */
  async function compareCandidates(doc: MapDocument, call: AgentCallContext): Promise<CompareCandidate[]> {
    const used = usedTilesets(doc), all = world.tilesets();
    const ordered = [...all.filter(t => used.has(t.id)), ...all.filter(t => !used.has(t.id) && !t.generated && !t.edited)]
      .filter(t => t.tileWidth === doc.map.tileWidth && t.tileHeight === doc.map.tileHeight);
    const out: CompareCandidate[] = [];
    for (const tileset of ordered) {
      let pixels: RgbaImage;
      try { pixels = await imagePixels(tileset.id, call.signal); } catch (error) { call.signal.throwIfAborted(); if (error instanceof AgentError) continue; throw error; }
      const count = tileset.edited?.nextTileId ?? tileset.columns * tileset.rows;
      for (let tileId = 0; tileId < count && out.length < REFERENCE_LIMITS.candidateTiles; tileId++) {
        const r = tileRect(tileset, tileId);
        if (r.x + r.width > pixels.width || r.y + r.height > pixels.height) continue;
        const data = new Uint8Array(r.width * r.height * 4);
        for (let y = 0; y < r.height; y++) data.set(pixels.data.subarray(((r.y + y) * pixels.width + r.x) * 4, ((r.y + y) * pixels.width + r.x + r.width) * 4), y * r.width * 4);
        const c = candidate({ tilesetId: tileset.id, tileId }, data);
        if (c) out.push(c);
      }
    }
    return out;
  }
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
      // Like render_compare: the picture covers the whole map and region crops the same cells.
      const full = mapping(args.referenceId, { x: 0, y: 0, width: map.width, height: map.height }, args.fit, args.sourceRect, map.tileWidth, map.tileHeight);
      const m: Mapping = { ...full, placement: { ...full.placement, x: full.placement.x - region.x, y: full.placement.y - region.y } };
      const grid = args.grid ?? true, coordinates = args.coordinates ?? true;
      const layout = previewLayout(region, map.tileWidth, map.tileHeight, { coordinates, ...(args.maxSide ? { maxSide: args.maxSide } : {}), ...(args.zoom ? { zoom: args.zoom } : {}) });
      const canvas = new RasterReplay(layout.width, layout.height, layout.contentRect);
      canvas.fill({ x: 0, y: 0, width: layout.width, height: layout.height }, [27, 33, 42, 255]); canvas.checker(layout.contentRect);
      drawReference(canvas, layout, m);
      const overlays = new RasterReplay(layout.width, layout.height);
      overlays.data.set(canvas.data);
      drawPreviewOverlays(overlays, layout, region, { grid, coordinates });
      call.signal.throwIfAborted();
      return {
        data: { mapId: args.mapId, referenceId: args.referenceId, region, fit: m.fit, sourceRect: m.sourceRect, cellPixels: { width: +(m.sourceRect.width / m.placement.width).toFixed(2), height: +(m.sourceRect.height / m.placement.height).toFixed(2) }, image: metadata(layout, region, map.tileWidth, map.tileHeight, grid, coordinates) },
        image: { png: encodeAgentPng(overlays), width: layout.width, height: layout.height, revision: revision(), warnings: [] },
      };
    },
    async quantize(args, call) {
      const { doc, store: mapStore } = await documentFor(args.mapId), map = doc.map, mapRevision = mapStore.revision;
      const region = args.region!;
      const m = mapping(args.referenceId, region, args.fit, args.sourceRect, map.tileWidth, map.tileHeight);
      const mode = !args.mode || args.mode === "auto" ? (looksLikeSketch(m.pixels, m.sourceRect) ? "sketch" : "render") : args.mode;
      const warnings: string[] = [];
      // Candidate tiles: explicit tiles, chosen tilesets, or the world's own (non-generated) art.
      const all = world.tilesets();
      const chosen = args.candidates?.tilesetIds ? all.filter(t => args.candidates!.tilesetIds!.includes(t.id))
        : args.candidates?.tiles ? all.filter(t => args.candidates!.tiles!.some(c => c.tilesetId === t.id))
          : all.filter(t => !t.generated && !t.edited).length ? all.filter(t => !t.generated && !t.edited) : all;
      const candidates: QuantizeCandidate[] = [];
      for (const tileset of chosen) {
        const pixels = await imagePixels(tileset.id, call.signal), count = tileset.edited?.nextTileId ?? tileset.columns * tileset.rows;
        const wanted = args.candidates?.tiles ? new Set(args.candidates.tiles.filter(c => c.tilesetId === tileset.id).map(c => c.tileId)) : null;
        for (let tileId = 0; tileId < count; tileId++) {
          if (wanted && !wanted.has(tileId)) continue;
          const r = tileRect(tileset, tileId);
          if (r.x + r.width > pixels.width || r.y + r.height > pixels.height) continue;
          const data = new Uint8Array(r.width * r.height * 4);
          let visible = false;
          for (let y = 0; y < r.height; y++) data.set(pixels.data.subarray(((r.y + y) * pixels.width + r.x) * 4, ((r.y + y) * pixels.width + r.x + r.width) * 4), y * r.width * 4);
          for (let i = 3; i < data.length; i += 4) if (data[i]) { visible = true; break; }
          if (visible) candidates.push({ tile: { tilesetId: tileset.id, tileId, flags: 0 }, pixels: { width: r.width, height: r.height, data } });
        }
        if (candidates.length > REFERENCE_LIMITS.candidateTiles) fail(AgentErrorCode.LIMIT_EXCEEDED, "More than 1024 candidate tiles", { nextAction: "Pass candidates.tilesetIds or candidates.tiles to narrow the search." });
      }
      if (!candidates.length) fail(AgentErrorCode.INVALID_ARGUMENT, "No visible candidate tiles", { nextAction: "Check candidates; tilesets need loaded artwork." });
      const legend: ColorLegendEntry[] = args.legend.map(entry => ({ rgb: parseHexColor(entry.hex)!, label: entry.label, ...(entry.cell !== undefined ? { cell: entry.cell } : {}), ...(entry.overlay !== undefined ? { overlay: entry.overlay } : {}), ...(entry.stampId ? { stampId: entry.stampId } : {}) }));
      if (mode === "render" && legend.length) warnings.push("colorLegend is used only in sketch mode");
      if (legend.some(l => l.overlay) && !args.overlayLayer) warnings.push("colorLegend overlay tiles need an overlay layer; they were left out");
      const probes: StampProbe[] = args.probes.map(p => ({ stampId: p.stampId, width: p.width, height: p.height, cells: p.cells }));
      const checkpoint = imageWork(call);
      const out = await quantizeReference({
        reference: m.pixels, sourceRect: m.sourceRect, region, fit: m.fit, mode, candidates,
        overlay: mode === "render" && !!args.overlayLayer, ...(mode === "sketch" ? { colorLegend: legend } : {}), stamps: probes, checkpoint,
      });
      if (mapStore.revision !== mapRevision) fail(AgentErrorCode.REVISION_CONFLICT, "Map changed during quantization", { nextAction: "Call reference_quantize again." });
      const layers: QuantizeLayerProposal[] = [{ layerId: args.groundLayer.id, layerName: args.groundLayer.name, origin: { x: region.x, y: region.y }, rows: out.groundRows, legend: out.groundLegend, counts: out.counts.ground }];
      if (args.overlayLayer && out.overlayRows && out.overlayRows.some(row => row.trim())) layers.push({ layerId: args.overlayLayer.id, layerName: args.overlayLayer.name, origin: { x: region.x, y: region.y }, rows: out.overlayRows, legend: out.overlayLegend, counts: out.counts.overlay });
      const stampNames = new Map(args.probes.map(p => [p.stampId, p.name]));
      const data = {
        mapId: args.mapId, referenceId: args.referenceId, region, mode, fit: m.fit, sourceRect: m.sourceRect, cellPixels: out.cellPixels,
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
      const cellsWanted = !!args.cells && !!args.referenceId;
      // Side by side stays within the 1568 px clients show unscaled; the heatmap is one more panel.
      const panels = (mode === "side" ? 2 : 1) + (cellsWanted ? 1 : 0);
      const maxSide = Math.min(args.maxSide ?? 1536, panels === 1 ? 2048 : panels === 2 ? 752 : 512);
      const before = args.baseline ? draftStartDocument(args.mapId, doc) : undefined;
      if (args.baseline && !before) fail(AgentErrorCode.INVALID_ARGUMENT, "This map has no draft start in the pending edit", { nextAction: "Compare a map that your pending edit includes." });
      const layerIds = args.layerIds;
      const options = { coordinates: true, maxSide, ...(layerIds ? { layerIds } : {}) };
      const plain = await renderMap(doc, region, { ...options, grid: false }, call);
      const layout = previewLayout(region, map.tileWidth, map.tileHeight, { coordinates: true, maxSide });
      // The picture lies on the whole map (or where the alignment says); region crops the same cells of both.
      const alignment = args.alignment && typeof args.alignment === "object" ? args.alignment : undefined;
      const pixels = args.referenceId ? referencePixels(args.referenceId) ?? fail(AgentErrorCode.UNKNOWN_ID, "Unknown referenceId") : undefined;
      if (pixels && args.sourceRect && (args.sourceRect.x + args.sourceRect.width > pixels.width || args.sourceRect.y + args.sourceRect.height > pixels.height)) fail(AgentErrorCode.OUT_OF_BOUNDS, "sourceRect lies outside the picture", { width: pixels.width, height: pixels.height });
      const frame = pixels ? referenceFrame(pixels, map, { alignment, fit: args.fit, sourceRect: args.sourceRect }) : undefined;
      const m: Mapping | undefined = pixels && frame ? { pixels, sourceRect: frame.sourceRect, placement: regionPlacement(frame, region), fit: args.fit ?? "stretch" } : undefined;
      // Mismatching cells: exact identity against the draft start, appearance against a picture.
      const mismatch = new Set<number>();
      if (before) for (const i of changedCells(before, doc, region)) mismatch.add(i);
      else if (m && frame) {
        const sketch = looksLikeSketch(m.pixels, m.sourceRect);
        const checkpoint = imageWork(call);
        for (let y = 0; y < region.height; y++) {
          const pause = checkpoint(); if (pause) await pause;
          for (let x = 0; x < region.width; x++) {
            if (!cellCovered(frame, region.x + x, region.y + y)) continue;
            const src = cellSource(frame, region.x + x, region.y + y);
            const a = cellFeature(m.pixels, src.x, src.y, src.width, src.height);
            const b = cellFeature(plain, layout.left + x * layout.cw, layout.top + y * layout.ch, layout.cw, layout.ch);
            if (featureDistance(a, b, sketch) > (sketch ? 56 : 36)) mismatch.add(y * region.width + x);
          }
        }
      }
      const cellReport = cellsWanted && frame && pixels ? await cellErrors(doc, region, frame, pixels, layerIds, call) : undefined;
      const sample = [...mismatch].slice(0, 32).map(i => ({ x: region.x + i % region.width, y: region.y + Math.floor(i / region.width) }));
      const withOverlays = (base: RgbaImage) => { const c = new RasterReplay(base.width, base.height); c.data.set(base.data); drawPreviewOverlays(c, layout, region, { grid: true, coordinates: true }); return c; };
      let shown: RgbaImage[];
      if (mode === "diff") {
        const canvas = withOverlays(plain);
        canvas.fill(layout.contentRect, [11, 18, 23, 130]);
        for (const i of mismatch) {
          const x = i % region.width, y = Math.floor(i / region.width);
          const cell = { x: layout.left + Math.floor(x * layout.cw), y: layout.top + Math.floor(y * layout.ch), width: Math.max(1, Math.ceil(layout.cw)), height: Math.max(1, Math.ceil(layout.ch)) };
          canvas.fill(cell, [240, 112, 122, 90]);
          if (layout.cw >= 6) canvas.outline(cell, [240, 112, 122, 255], layout.cw >= 24 ? 2 : 1);
        }
        shown = [canvas];
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
          shown = [withOverlays(blended)];
        } else shown = [withOverlays(base), withOverlays(plain)];
      }
      let heatmap: { rect: Rect } | undefined;
      if (cellReport) {
        const panel = new RasterReplay(plain.width, plain.height, layout.contentRect);
        panel.fill({ x: 0, y: 0, width: plain.width, height: plain.height }, [27, 33, 42, 255]); panel.checker(layout.contentRect);
        const box = (x: number, y: number) => ({ x: layout.left + Math.floor(x * layout.cw), y: layout.top + Math.floor(y * layout.ch), width: Math.max(1, Math.ceil(layout.cw)), height: Math.max(1, Math.ceil(layout.ch)) });
        cellReport.errors.forEach((err, i) => { if (err >= 0) panel.fill(box(i % region.width, Math.floor(i / region.width)), heatColor(err)); });
        drawPreviewOverlays(panel, layout, region, { grid: true, coordinates: true });
        cellReport.worst.forEach((w, rank) => {
          const cell = box(w.x - region.x, w.y - region.y);
          if (layout.cw >= 6) panel.outline(cell, [255, 255, 255, 255], layout.cw >= 24 ? 2 : 1);
          const scale = layout.cw >= 24 ? 2 : 1, label = String(rank + 1);
          if (layout.cw >= textWidth(label, scale) + 2 * scale + 2) panel.label(label, cell.x + 1, cell.y + 1, scale);
        });
        heatmap = { rect: { x: shown.reduce((n, i) => n + i.width + 8, 0), y: 0, width: panel.width, height: panel.height } };
        shown.push(panel);
      }
      const picture = shown.length === 1 ? shown[0]! : compose(shown, 8);
      call.signal.throwIfAborted();
      if (mapStore.revision !== mapRevision) fail(AgentErrorCode.REVISION_CONFLICT, "Map changed during comparison");
      const image: PreviewImage = { ...metadata(layout, region, map.tileWidth, map.tileHeight, true, true), width: picture.width, height: picture.height };
      const data: RenderCompareData = {
        mapId: args.mapId, region, mode, against: m ? "reference" : "draftStart", image, mismatch: { cells: mismatch.size, ratio: +(mismatch.size / (region.width * region.height)).toFixed(4), sample }, mapRevision,
        ...(frame ? { alignment: alignment ?? "none", cellPixels: { width: +frame.pxX.toFixed(2), height: +frame.pxY.toFixed(2) } } : {}),
        ...(cellReport ? { stats: cellReport.stats, worst: cellReport.worst, heatmap: heatmap! } : {}),
      };
      return { data, image: { png: encodeAgentPng(picture), width: picture.width, height: picture.height, revision: revision(), warnings: [] } };
    },
  };
}
