import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, encodeRgbaPng, MapStore, type RgbaImage } from "@smap/core";
import type { AgentCallContext, AgentWorldPort, ReferenceAlignment } from "@smap/agent";
import { clearTilesetImages, setTilesetImage } from "../state/tilesetImages";
import { decodeWorkingSourcePng } from "../io/sourcePng";
import { clearAgentWorld, resetAgentWorld } from "./editGate";
import { clearReferences, createReferencePort } from "./referenceLibrary";
import { createObjectsPort } from "./objectsPort";
import { hardReference, pack, packPixels, placements, SCENE, sceneMapPixels, stamps, T } from "./objects/testing/objectScene";

const call: AgentCallContext = { clientSessionId: "c", clientInfo: { name: "T", version: "1" }, bridgeEpoch: "e", deadline: Date.now() + 120000, signal: { aborted: false, throwIfAborted() {}, onAbort: () => () => {} } };
const base64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(s); };
const png = (image: RgbaImage) => encodeRgbaPng(image.width, image.height, new Uint8Array(image.data));
function setup() {
  const art = packPixels();
  setTilesetImage({ tilesetId: pack.id, bytes: png(art), bitmap: { width: art.width, height: art.height, close: vi.fn() } as unknown as ImageBitmap });
  const store = new MapStore(createDocument({ width: SCENE.width, height: SCENE.height, tileWidth: T, tileHeight: T, tilesets: [pack] }));
  const world = { tilesets: () => [pack], stamps: () => stamps, loadMap: async () => store } as unknown as AgentWorldPort;
  return { references: createReferencePort(world, () => 1), objects: createObjectsPort(world, () => 1) };
}
const expected = placements.map(p => { const y = Math.round((p.y * T + (p.dy ?? 0)) / T); return `${p.stampId}@${p.x},${y}`; }).sort();
beforeEach(() => { resetAgentWorld(); clearReferences(); });
afterEach(() => { clearTilesetImages(); clearAgentWorld(); });

describe("object tools host", () => {
  it("detects every stamp of a hard reference through an explicit alignment, with place_stamp positions and a preview", async () => {
    const { references, objects } = setup();
    const ref = await references.add({ imageBase64: base64(png(hardReference(3, 22, -5))) }, call);
    const alignment: ReferenceAlignment = { cellPx: 48, scale: 3, offsetX: 22, offsetY: -5, cols: SCENE.width, rows: SCENE.height, confidence: 0.9, method: "manual" };
    const out = await objects.detect({ referenceId: ref.referenceId, mapId: "m", stampIds: stamps.map(s => s.id), alignment }, call);
    expect(out.data.alignment).toEqual(alignment);
    expect(out.data.warnings).toEqual([]);
    expect(out.data.matches.map(m => `${m.stampId}@${m.x},${m.y}`).sort()).toEqual(expected);
    expect(out.data.positionsByStamp.crate!.sort()).toEqual([[13, 13], [2, 2], [3, 2]].sort());
    expect(out.data.matches.find(m => m.stampId === "smallCrate" && m.y === 8)!.pixelResidual).toEqual({ dx: 0, dy: 6 });
    // Small crates stacked in front of the big crates / crate: placed last, on the layer above.
    expect(out.data.stacked!.map(g => [g.stampId, [...g.positions].sort()])).toEqual([["smallCrate", [[11, 6], [13, 12], [4, 8]].sort()]]);
    expect(out.data.matches.filter(m => m.front).every(m => m.stampId === "smallCrate")).toBe(true);
    expect(Object.keys(out.data.stacked![0]!).sort()).toEqual(["positions", "stampId"]);
    const preview = decodeWorkingSourcePng(out.image!.png);
    expect([preview.width, preview.height]).toEqual([out.data.image!.width, out.data.image!.height]);
    // Narrowed search, stricter score, no preview.
    const crates = await objects.detect({ referenceId: ref.referenceId, mapId: "m", stampIds: ["crate"], alignment, preview: false, minScore: 0.95 }, call);
    expect(crates.image).toBeUndefined();
    expect(crates.data.matches.every(m => m.stampId === "crate" && m.score >= 0.95)).toBe(true);
  }, 30000);

  it("without an alignment detects the grid (auto) and with alignment:none fits the picture onto the map", async () => {
    const { references, objects } = setup();
    const scene = sceneMapPixels(), doubled = { width: scene.width * 2, height: scene.height * 2, data: new Uint8Array(scene.width * scene.height * 16) };
    for (let y = 0; y < doubled.height; y++) for (let x = 0; x < doubled.width; x++) doubled.data.set(scene.data.subarray(((y >> 1) * scene.width + (x >> 1)) * 4, ((y >> 1) * scene.width + (x >> 1)) * 4 + 4), (y * doubled.width + x) * 4);
    const ref = await references.add({ imageBase64: base64(png(doubled)) }, call);
    const out = await objects.detect({ referenceId: ref.referenceId, mapId: "m", stampIds: stamps.map(s => s.id), preview: false }, call);
    expect(out.data.alignment).toMatchObject({ cellPx: 32, scale: 2, offsetX: 0, offsetY: 0, cols: SCENE.width, rows: SCENE.height, method: "auto" });
    expect(out.data.alignment.confidence).toBeGreaterThan(0.35);
    expect(out.data.warnings).toEqual([]);
    expect(out.data.matches.map(m => `${m.stampId}@${m.x},${m.y}`).sort()).toEqual(expected);
    const quiet = await objects.detect({ referenceId: ref.referenceId, mapId: "m", stampIds: ["torch"], alignment: "none", preview: false }, call);
    expect(quiet.data.warnings).toEqual([]);
    expect(quiet.data.alignment).toMatchObject({ cellPx: 32, offsetX: 0, offsetY: 0, confidence: 0 });
  }, 30000);

  it("finds mirrored stamps and returns them as flipped place_stamp groups", async () => {
    const { references, objects } = setup();
    const ref = await references.add({ imageBase64: base64(png(hardReference(2, 6, 4, 9, [{ stampId: "torch", x: 22, y: 6, flip: 2 }]))) }, call);
    const alignment: ReferenceAlignment = { cellPx: 32, scale: 2, offsetX: 6, offsetY: 4, cols: SCENE.width, rows: SCENE.height, confidence: 1, method: "manual" };
    const out = await objects.detect({ referenceId: ref.referenceId, mapId: "m", stampIds: ["torch", "barrel"], alignment, preview: false }, call);
    expect(out.data.flipped).toEqual([{ stampId: "torch", flipY: true, positions: [[22, 6]] }]);
    expect(out.data.positionsByStamp.torch!.sort()).toEqual([[16, 9], [8, 1]].sort());
    expect(out.data.matches.filter(m => m.flipX)).toEqual([]);
    const plain = await objects.detect({ referenceId: ref.referenceId, mapId: "m", stampIds: ["torch"], alignment, flips: false, preview: false }, call);
    expect(plain.data.flipped).toBeUndefined();
  }, 30000);

  it("suggests stamp candidates with a numbered sheet preview", async () => {
    const { objects } = setup();
    const out = await objects.suggest({ tilesetId: pack.id }, call);
    expect(out.data.candidates.map(c => [c.n, c.tileIds, c.existingStampId])).toEqual([[1, [12, 20], "torch"], [2, [13, 14, 21, 22], "bigCrate"], [3, [15, 23], "net"]]);
    expect(out.data.image).toMatchObject({ scale: 8, origin: { x: 0, y: 0 } });
    const sheet = decodeWorkingSourcePng(out.image!.png);
    expect([sheet.width, sheet.height]).toEqual([out.data.image!.width, out.data.image!.height]);
    await expect(objects.suggest({ tilesetId: "nope" }, call)).rejects.toMatchObject({ code: "UNKNOWN_ID" });
  });
});
