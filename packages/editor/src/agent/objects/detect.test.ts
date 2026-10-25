import { describe, expect, it } from "vitest";
import type { ReferenceAlignment } from "@smap/agent";
import { detectObjects } from "./detect";
import { resampleToMapPixels, stampRgba } from "./raster";
import { hardReference, pack, packPixels, placements, SCENE, sceneMapPixels, stamps, T } from "./testing/objectScene";

const art = packPixels();
const templates = stamps.map(s => ({ id: s.id, cellsW: s.width, cellsH: s.height, image: stampRgba(s, [pack], () => art, T, T).image }));
/** Recoloured look-alikes that are not in the picture: the light model must not turn one into the other. */
const decoys = templates.slice(0, 5).map(t => {
  const data = new Uint8Array(t.image.data);
  for (let i = 0; i < data.length; i += 4) { data[i] = Math.min(255, data[i]! * 0.6 + 80); data[i + 2] = data[i + 2]! * 0.5; }
  return { ...t, id: `${t.id}-red`, image: { ...t.image, data } };
});
const expected = placements.map(p => {
  const y = Math.round((p.y * T + (p.dy ?? 0)) / T), x = Math.round((p.x * T + (p.dx ?? 0)) / T);
  return { stampId: p.stampId, x, y, dx: p.x * T + (p.dx ?? 0) - x * T, dy: p.y * T + (p.dy ?? 0) - y * T };
});
const key = (m: { stampId: string; x: number; y: number }) => `${m.stampId}@${m.x},${m.y}`;

async function run(scale: number, offsetX: number, offsetY: number) {
  const reference = hardReference(scale, offsetX, offsetY);
  const alignment: ReferenceAlignment = { cellPx: T * scale, scale, offsetX, offsetY, cols: SCENE.width, rows: SCENE.height, confidence: 1, method: "manual" };
  const work = resampleToMapPixels(reference, alignment, T, T, SCENE.width, SCENE.height);
  return detectObjects({ work, tileWidth: T, tileHeight: T, templates: [...templates, ...decoys], minScore: 0.85, maxMatches: 256 });
}

describe("object detection", () => {
  it("renders stamps with their real alpha and resamples an integer-scaled picture to exact map pixels", () => {
    const crate = templates.find(t => t.id === "crate")!.image;
    expect(crate.data[3]).toBe(0);
    expect(crate.data[(1 * T + 1) * 4 + 3]).toBe(255);
    const scene = sceneMapPixels(), reference = { width: scene.width * 3 + 5, height: scene.height * 3 + 2, data: new Uint8Array((scene.width * 3 + 5) * (scene.height * 3 + 2) * 4) };
    for (let y = 0; y < scene.height * 3; y++) for (let x = 0; x < scene.width * 3; x++) {
      const s = (Math.floor(y / 3) * scene.width + Math.floor(x / 3)) * 4;
      reference.data.set(scene.data.subarray(s, s + 4), ((y + 2) * reference.width + x + 5) * 4);
    }
    const work = resampleToMapPixels(reference, { cellPx: 48, scale: 3, offsetX: 5, offsetY: 2, cols: SCENE.width, rows: SCENE.height, confidence: 1, method: "manual" }, T, T, SCENE.width, SCENE.height);
    expect(Buffer.from(work.data).equals(Buffer.from(scene.data))).toBe(true);
  });

  it("finds every object of a clean render, stacked crates included, without false positives", async () => {
    const work = sceneMapPixels();
    const out = await detectObjects({ work, tileWidth: T, tileHeight: T, templates, minScore: 0.85, maxMatches: 256 });
    expect(out.matches.map(m => key({ stampId: m.id, x: m.x, y: m.y })).sort()).toEqual(expected.map(key).sort());
    for (const e of expected) expect(out.matches.find(m => key({ stampId: m.id, x: m.x, y: m.y }) === key(e))).toMatchObject({ dx: e.dx, dy: e.dy });
  }, 30000);

  for (const [scale, ox, oy] of [[4, 13, 7], [3, 22, -5]] as const) {
    it(`finds objects in a hard ×${scale} reference (offset ${ox},${oy}, cropped, uneven light, glow, noise)`, async () => {
      const out = await run(scale, ox, oy);
      const found = new Set(out.matches.map(m => key({ stampId: m.id, x: m.x, y: m.y })));
      const hits = expected.filter(e => found.has(key(e)));
      const extra = out.matches.filter(m => !expected.some(e => key(e) === key({ stampId: m.id, x: m.x, y: m.y })));
      console.info(`×${scale}: found ${hits.length}/${expected.length}, extra ${extra.length}, min score ${Math.min(...out.matches.map(m => m.score)).toFixed(3)}`, expected.filter(e => !found.has(key(e))), extra);
      expect(hits.length).toBe(expected.length);
      expect(extra).toEqual([]);
      // Stacked: the small crates on the big crates and on the crate, each with its off-grid residual.
      const cells = (id: string) => out.matches.filter(m => m.id === id).map(m => `${m.x},${m.y},${m.dy}`).sort();
      expect(cells("smallCrate")).toEqual(["11,6,0", "13,12,5", "4,8,6"]);
      expect(cells("bigCrate")).toEqual(["10,6,0", "4,9,0"]);
    }, 30000);
  }

  it("is deterministic and respects maxMatches", async () => {
    const work = sceneMapPixels();
    const a = await detectObjects({ work, tileWidth: T, tileHeight: T, templates, minScore: 0.85, maxMatches: 256 });
    const b = await detectObjects({ work, tileWidth: T, tileHeight: T, templates, minScore: 0.85, maxMatches: 256 });
    expect(b).toEqual(a);
    const capped = await detectObjects({ work, tileWidth: T, tileHeight: T, templates, minScore: 0.85, maxMatches: 3 });
    expect(capped.matches).toHaveLength(3);
    expect(capped.truncated).toBe(true);
    expect(capped.matches).toEqual(a.matches.slice(0, 3));
  }, 30000);
});
