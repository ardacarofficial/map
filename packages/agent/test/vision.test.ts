import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { autoTrim, looksLikeSketch, quantizeReference, type QuantizeCandidate } from "../src/tools/quantize";
import type { AgentReferencePort, ReferenceQuantizeRequest } from "../src/vision";
import { harness, success, error } from "./helpers";

const T = 8;
/** Distinct textured opaque tiles plus one transparent overlay (a dark diamond). */
function tiles(): QuantizeCandidate[] {
  const out: QuantizeCandidate[] = [];
  const colors = [[80, 170, 70], [140, 100, 60], [54, 113, 201], [200, 200, 190]];
  colors.forEach((c, id) => {
    const data = new Uint8Array(T * T * 4);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const p = (y * T + x) * 4, stripe = (x + y * (id + 1)) % 4 === 0 ? 30 : 0;
      data[p] = c[0]! - stripe; data[p + 1] = c[1]! - stripe; data[p + 2] = c[2]! - stripe; data[p + 3] = 255;
    }
    out.push({ tile: { tilesetId: "art", tileId: id, flags: 0 }, pixels: { width: T, height: T, data } });
  });
  const overlay = new Uint8Array(T * T * 4);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (Math.abs(x - 3.5) + Math.abs(y - 3.5) < 3) { const p = (y * T + x) * 4; overlay[p] = 20; overlay[p + 1] = 60; overlay[p + 2] = 20; overlay[p + 3] = 255; }
  out.push({ tile: { tilesetId: "art", tileId: 4, flags: 0 }, pixels: { width: T, height: T, data: overlay } });
  return out;
}
/** Render a ground/overlay grid at an integer scale with a dark editor gutter. */
function render(candidates: QuantizeCandidate[], ground: number[], overlay: (number | null)[], w: number, h: number, scale: number, gutter: number) {
  const width = gutter + w * T * scale, height = gutter + h * T * scale, data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([27, 33, 42, 255], i * 4);
  for (let y = 0; y < h * T * scale; y++) for (let x = 0; x < w * T * scale; x++) {
    const cx = Math.floor(x / (T * scale)), cy = Math.floor(y / (T * scale)), tx = Math.floor(x / scale) % T, ty = Math.floor(y / scale) % T;
    const g = candidates[ground[cy * w + cx]!]!.pixels.data, o = overlay[cy * w + cx];
    const p = (ty * T + tx) * 4, q = ((gutter + y) * width + gutter + x) * 4;
    let rgb = [g[p]!, g[p + 1]!, g[p + 2]!];
    if (o !== null && o !== undefined) { const od = candidates[o]!.pixels.data, a = od[p + 3]! / 255; rgb = rgb.map((v, c) => od[p + c]! * a + v * (1 - a)); }
    data.set([...rgb.map(Math.round), 255], q);
  }
  return { width, height, data };
}

describe("reference quantizer", () => {
  it("reproduces painted ground and overlay exactly from a scaled render with gutters", async () => {
    const candidates = tiles();
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 2, max: 6 }), fc.integer({ min: 2, max: 5 }), fc.integer({ min: 1, max: 3 }), fc.integer({ min: 0, max: 1000 }),
      async (w, h, scale, seed) => {
        let s = seed;
        const rand = (n: number) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
        const ground = Array.from({ length: w * h }, () => rand(4));
        const overlay = Array.from({ length: w * h }, () => rand(3) === 0 ? 4 : null);
        const reference = render(candidates, ground, overlay, w, h, scale, 4);
        const sourceRect = autoTrim(reference);
        expect(sourceRect).toEqual({ x: 4, y: 4, width: w * T * scale, height: h * T * scale });
        expect(looksLikeSketch(reference, sourceRect)).toBe(false);
        const out = await quantizeReference({ reference, sourceRect, region: { x: 0, y: 0, width: w, height: h }, fit: "stretch", mode: "render", candidates, overlay: true });
        expect(out.cells.map(c => c.ground)).toEqual(ground);
        expect(out.cells.map(c => c.overlay < 0 ? null : c.overlay)).toEqual(overlay);
        // Rows + legend decode back to the same tiles (C1 round trip); space only where nothing is proposed.
        const decoded = out.groundRows.flatMap(row => [...row].map(ch => out.groundLegend[ch]));
        expect(decoded).toEqual(ground.map(g => ({ tilesetId: "art", tileId: g })));
        const decodedOverlay = out.overlayRows!.flatMap(row => [...row].map(ch => ch === " " ? null : out.overlayLegend[ch]));
        expect(decodedOverlay).toEqual(overlay.map(o => o === null ? null : { tilesetId: "art", tileId: o }));
        expect(out.confidence.low).toBe(0);
      }), { numRuns: 25 });
  });

  it("maps sketch colours through a legend and places legend stamps on colour blobs", async () => {
    const W = 10, H = 6, px = 10, data = new Uint8Array(W * px * H * px * 4);
    for (let y = 0; y < H * px; y++) for (let x = 0; x < W * px; x++) {
      const cx = Math.floor(x / px), cy = Math.floor(y / px);
      const color = cx >= 6 && cx <= 7 && cy >= 2 && cy <= 3 ? [200, 40, 40] : cy === 1 ? [50, 110, 220] : [110, 190, 90];
      data.set([...color, 255], (y * W * px + x) * 4);
    }
    const reference = { width: W * px, height: H * px, data };
    const sourceRect = autoTrim(reference);
    expect(looksLikeSketch(reference, sourceRect)).toBe(true);
    const out = await quantizeReference({
      reference, sourceRect, region: { x: 0, y: 0, width: W, height: H }, fit: "stretch", mode: "sketch", candidates: tiles(), overlay: false,
      colorLegend: [
        { rgb: [50, 110, 220], label: "su", cell: { tilesetId: "art", tileId: 2 } },
        { rgb: [200, 40, 40], label: "house", stampId: "house" },
      ],
      stamps: [{ stampId: "house", width: 2, height: 2, cells: [] }],
    });
    expect(out.groundRows[1]).toMatch(/^(.)\1{9}$/);
    expect(out.groundLegend[out.groundRows[1]![0]!]).toEqual({ tilesetId: "art", tileId: 2 });
    // Grass gets its nearest tile; the house blob keeps the dominant ground underneath.
    expect(out.groundLegend[out.groundRows[0]![0]!]).toEqual({ tilesetId: "art", tileId: 0 });
    expect(out.groundRows[2]![6]).toBe(out.groundRows[0]![0]);
    expect(out.stamps).toEqual([{ stampId: "house", at: { x: 6, y: 2 }, source: "legend" }]);
    expect(out.palette.map(p => p.legend ?? "auto")).toEqual(expect.arrayContaining(["su", "house", "auto"]));
  });

  it("leaves uncovered cells as keep with fit contain", async () => {
    const candidates = tiles();
    const reference = render(candidates, [0, 1], [null, null], 2, 1, 1, 0);
    const out = await quantizeReference({ reference, sourceRect: { x: 0, y: 0, width: 16, height: 8 }, region: { x: 0, y: 0, width: 2, height: 4 }, fit: "contain", mode: "render", candidates, overlay: false });
    expect(out.groundRows.filter(row => row.trim()).length).toBe(1);
    expect(out.confidence.uncovered).toBe(6);
  });
});

describe("reference tools", () => {
  function port(calls: ReferenceQuantizeRequest[]): AgentReferencePort {
    const list = [{ referenceId: "ref-1", name: "Köy", width: 64, height: 64, origin: "user" as const }];
    return {
      list: () => list,
      add: async () => list[0]!,
      view: async args => ({ data: { mapId: args.mapId, referenceId: args.referenceId, region: { x: 0, y: 0, width: 16, height: 16 }, fit: "stretch", sourceRect: { x: 0, y: 0, width: 64, height: 64 }, cellPixels: { width: 4, height: 4 }, image: { width: 1, height: 1, scale: 1, pixelOrigin: { x: 0, y: 0 }, cellSize: { width: 1, height: 1 }, contentRect: { x: 0, y: 0, width: 1, height: 1 }, grid: true, coordinates: true } } }),
      quantize: async args => { calls.push(args); return { data: { mapId: args.mapId, referenceId: args.referenceId, region: args.region!, mode: "sketch", fit: "stretch", sourceRect: { x: 0, y: 0, width: 64, height: 64 }, cellPixels: { width: 4, height: 4 }, grid: { layers: [] }, confidence: { high: 0, medium: 0, low: 0, uncovered: 0, meanError: 0, lowCells: [], lowCellsTruncated: false }, stamps: [], warnings: [], mapRevision: 0 } }; },
      compare: async () => { throw new Error("unused"); },
    };
  }
  it("explains a missing reference host and an unknown referenceId", async () => {
    const h = harness();
    error(await h.run("reference_quantize", { referenceId: "x", mapId: "map-1" }), "EDITOR_UNAVAILABLE");
    h.host.references = port([]);
    const failure = (await h.run("reference_view", { referenceId: "nope", mapId: "map-1" })).structuredContent;
    expect(failure).toMatchObject({ ok: false, code: "UNKNOWN_ID", details: { validIds: ["ref-1"] } });
    expect(success(await h.run("get_session", {})).data).toMatchObject({ references: [{ referenceId: "ref-1", name: "Köy" }] });
  });
  it("resolves layers, tag words and stamps before quantizing, without context", async () => {
    const calls: ReferenceQuantizeRequest[] = [];
    const h = harness({ stamps: [{ id: "house", name: "House", width: 2, height: 1, palette: [{ tilesetId: "tiles", tileId: 4 }], layers: [{ layerId: "l", name: "Üst", cells: Uint32Array.of(1, 0) }] }] });
    h.host.references = port(calls);
    error(await h.run("reference_quantize", { referenceId: "ref-1", mapId: "map-1", colorLegend: { "#2a6fdb": "su" } }), "INVALID_ARGUMENT");
    success(await h.run("reference_quantize", { referenceId: "ref-1", mapId: "map-1", region: { x: 0, y: 0, width: 4, height: 4 }, colorLegend: { "#c82828": { stampId: "house" }, "#6ebe5a": { tilesetId: "tiles", tileId: 1 } } }));
    expect(calls[0]).toMatchObject({
      groundLayer: { id: "ground" }, overlayLayer: null,
      legend: [{ hex: "#c82828", stampId: "house" }, { hex: "#6ebe5a", cell: { tilesetId: "tiles", tileId: 1 } }],
      probes: [{ stampId: "house", width: 2, height: 1, cells: [{ x: 0, y: 0, tile: { tilesetId: "tiles", tileId: 4, flags: 0 } }] }],
    });
    error(await h.run("reference_quantize", { referenceId: "ref-1", mapId: "map-1", layers: { ground: "collision" } }), "INVALID_ARGUMENT");
    error(await h.run("render_compare", { mapId: "map-1", baseline: "draftStart" }), "INVALID_ARGUMENT");
    error(await h.run("reference_add", { path: "/tmp/notes.txt" }), "INVALID_ARGUMENT");
  });
  it("routes reference_align to the host with the active map and validates hints", async () => {
    const h = harness();
    const seen: unknown[] = [];
    const alignment = { cellPx: 64, scale: 4, offsetX: 13, offsetY: 7, cols: 30, rows: 21, confidence: 0.9, method: "auto" as const };
    h.host.references = { ...port([]), align: async args => { seen.push(args); return { data: { mapId: args.mapId, referenceId: args.referenceId, alignment, saved: args.save !== false, content: { x: 0, y: 0, width: 64, height: 64 }, image: { width: 1, height: 1, scale: 1 }, warnings: [] } }; } };
    expect(success(await h.run("reference_align", { referenceId: "ref-1", hint: { scale: 4 } })).data).toMatchObject({ mapId: "map-1", alignment, saved: true });
    expect(seen[0]).toMatchObject({ mapId: "map-1", hint: { scale: 4 } });
    error(await h.run("reference_align", { referenceId: "ref-1", hint: { scale: -1 } }), "INVALID_ARGUMENT");
    error(await h.run("reference_align", { referenceId: "nope" }), "UNKNOWN_ID");
    success(await h.run("reference_quantize", { referenceId: "ref-1", mapId: "map-1", alignment: { cellPx: 64, offsetX: 13, offsetY: 7 }, normalizeLight: false }));
    error(await h.run("reference_quantize", { referenceId: "ref-1", mapId: "map-1", alignment: "grid" }), "INVALID_ARGUMENT");
  });
});
