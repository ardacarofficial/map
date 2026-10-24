import { describe, expect, it } from "vitest";
import { createDocument } from "../src/document";
import { MapStore } from "../src/store";
import { innerMiterSpans, isInnerJoinQuadrant, nineSliceBlits, nineSliceLayout } from "../src/nineSlice";
import { BLOB47_MASKS } from "../src/smartStamp/topology";
import { buildRoadProfile } from "../src/smartStamp/roadProfile";
import { roadMembership, roadTileInfo } from "../src/smartStamp/roadSolver";
import { findSmartCandidates } from "../src/smartStamp/candidates";
import { applySmartStampArea, applySmartStampRoad, openEdgeRect, planSmartStampArea } from "../src/smartStamp";
import { prepareNineSliceTileset, regenerateNineSliceTileset } from "../src/generatedTileset";
import { cellFlags, cellPaletteIndex } from "../src/cell";
import { normalizeTileset, type Tileset } from "../src/tileset";
import type { Stamp } from "../src/stamp";
import { source } from "./smartStampHelpers";
import { boundaryArt } from "./smartStampBoundaryArt";

/** Rasterize tile ids (not pixels) of one slot: every destination pixel names the source tile copied there. */
function slotIds(blits: ReturnType<typeof nineSliceBlits>, slot: number, size: number): number[] {
  const out = new Array<number>(size * size).fill(-1);
  for (const b of blits) if (b.slot === slot) for (let y = 0; y < b.destinationRect.height; y++) for (let x = 0; x < b.destinationRect.width; x++)
    out[(b.destinationRect.y + y) * size + b.destinationRect.x + x] = b.tile.tileId;
  return out;
}

describe("mitered inner joins", () => {
  it("splits each concave quadrant on its diagonal between the two adjoining edge strips", () => {
    expect(innerMiterSpans(0, { x: 0, y: 0, width: 4, height: 4 }, 8, 8).filter(s => s.strip === "horizontal").map(s => [s.x, s.y, s.width, s.height]))
      .toEqual([[0, 1, 1, 1], [0, 2, 2, 1], [0, 3, 3, 1]]);
    for (const size of [5, 8, 9, 32]) for (let q = 0; q < 4; q++) {
      const rect = { x: q === 1 || q === 2 ? Math.floor(size / 2) : 0, y: q >= 2 ? Math.floor(size / 2) : 0, width: q === 1 || q === 2 ? size - Math.floor(size / 2) : Math.floor(size / 2), height: q >= 2 ? size - Math.floor(size / 2) : Math.floor(size / 2) };
      const area = innerMiterSpans(q, rect, size, size).reduce((n, s) => n + s.width * s.height, 0);
      expect(area).toBe(rect.width * rect.height);
    }
  });

  it("bakes every inner quadrant from the adjoining strips, keeps other quadrants and the legacy recipe intact", () => {
    const s = source(3, 3), size = 8, half = 4, l = nineSliceLayout(s);
    const legacy = nineSliceBlits(s, "s", size, size), miter = nineSliceBlits(s, "s", size, size, undefined, "miter");
    BLOB47_MASKS.forEach((mask, rank) => {
      const a = slotIds(legacy, l.bank + rank, size), b = slotIds(miter, l.bank + rank, size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const q = y < half ? x < half ? 0 : 1 : x < half ? 3 : 2, i = y * size + x;
        if (!isInnerJoinQuadrant(mask, q)) { expect(b[i]).toBe(a[i]); continue; }
        // Distance to the left/right side versus the top/bottom side decides which neighbour's border continues.
        const dx = q === 1 || q === 2 ? size - 1 - x : x, dy = q >= 2 ? size - 1 - y : y;
        const horizontal = q >= 2 ? 7 : 1, vertical = q === 1 || q === 2 ? 5 : 3;
        expect(b[i]).toBe(dx < dy ? horizontal : vertical);
        expect(a[i]).toBe(4);
      }
    });
    // Source copies, collapsed caps and isolated slots are unchanged.
    expect(miter.filter(b => b.slot < l.bank)).toEqual(legacy.filter(b => b.slot < l.bank));
  });

  it("miters thick-band macro patches with band roles and full coverage", () => {
    const s = { ...source(5, 5), nineSlice: { border: 2, tileLayers: [] } } as unknown as Stamp, size = 4, l = nineSliceLayout(s);
    const blits = nineSliceBlits(s, "s", size, size, undefined, "miter"), mask = BLOB47_MASKS.indexOf(255 & ~128);
    const area = new Map<number, number>();
    for (const b of blits) area.set(b.slot, (area.get(b.slot) ?? 0) + b.destinationRect.width * b.destinationRect.height);
    for (let slot = l.bank; slot < l.slots; slot++) expect(area.get(slot)).toBe(size * size);
    // The NW inner quadrant of the 2×2 macro patch is exactly its top-left tile: no centre (tile 12) pixels remain.
    expect(slotIds(blits, l.bank + mask * 4, size)).not.toContain(12);
  });

  it("persists innerJoin, regenerates it unchanged, and lets null restore the legacy join", () => {
    const s: Stamp = { ...source(3, 3), id: "river", name: "River" };
    const src: Tileset = normalizeTileset({ id: "source", name: "Source", imagePath: "tilesets/source.png", tileWidth: 8, tileHeight: 8, columns: 3, rows: 3, margin: 0, spacing: 0 });
    const opts = { id: "gen", imagePath: "tilesets/gen.png", tileWidth: 8, tileHeight: 8, tilesets: [src], imageHashes: new Map([["source", "h1"]]) };
    const fresh = prepareNineSliceTileset(s, "s", { ...opts, innerJoin: "miter" });
    expect(fresh.generated!.innerJoin).toBe("miter");
    expect(normalizeTileset(JSON.parse(JSON.stringify(fresh))).generated).toEqual(fresh.generated);
    const again = regenerateNineSliceTileset(s, "s", "gen", { tilesets: [src, fresh], imageHashes: new Map([["source", "h2"]]) });
    expect(again.generated!.innerJoin).toBe("miter");
    const legacy = regenerateNineSliceTileset(s, "s", "gen", { tilesets: [src, fresh], imageHashes: new Map([["source", "h2"]]), innerJoin: null });
    expect(legacy.generated!.innerJoin).toBeUndefined();
    expect(prepareNineSliceTileset(s, "s", opts).generated!.innerJoin).toBeUndefined();
  });
});

function fixture(width = 16, height = 12) {
  const s = source(3, 3), l = nineSliceLayout(s), profile = buildRoadProfile(s, "s");
  const stamp: Stamp = { ...s, id: "road", name: "Road", nineSlice: { border: 1, tileLayers: [{ layerId: "s", tilesetId: "baked" }], road: { tilesetId: "baked", profile } } };
  const store = new MapStore(createDocument({ width, height, seed: 3, tilesets: [{ id: "baked", name: "Baked", imagePath: "tilesets/baked.png", tileWidth: 32, tileHeight: 32, columns: l.slots, rows: 1, margin: 0, spacing: 0, roadProfile: profile }] }));
  store.dispatch({ type: "addLayer", layer: { id: "l", name: "Ground" } });
  store.clearHistory();
  const mask = (x: number, y: number) => {
    const c = store.document.getLayer("l")!.getCell(x, y), info = roadTileInfo(profile, "baked", c ? store.document.palette.get(cellPaletteIndex(c)) : null, cellFlags(c));
    return info.kind === "blob" ? info.mask : -1;
  };
  return { store, stamp, mask };
}

describe("open map edges", () => {
  it("leaves roads touching the border uncapped only when requested", () => {
    const closed = fixture(), open = fixture(), cells = [0, 1, 2, 3].map(x => ({ x, y: 5 }));
    applySmartStampRoad(closed.store, closed.stamp, "l", roadMembership(cells));
    applySmartStampRoad(open.store, open.stamp, "l", roadMembership(cells), { openEdges: true });
    expect(closed.mask(0, 5) & 64).toBe(0);
    expect(open.mask(0, 5) & 64).toBe(64);
    expect(open.mask(3, 5) & 4).toBe(0);
    expect(open.store.undoDepth).toBe(1);
  });

  it("extends only border-touching area sides by one band so the edge row keeps interior art", () => {
    const { store, stamp, mask } = fixture();
    expect(openEdgeRect(store.document, stamp, { x: 0, y: 3, width: 4, height: 9 })).toEqual({ x: -1, y: 3, width: 5, height: 10 });
    expect(openEdgeRect(store.document, stamp, { x: 2, y: 2, width: 3, height: 3 })).toEqual({ x: 2, y: 2, width: 3, height: 3 });
    applySmartStampArea(store, stamp, openEdgeRect(store.document, stamp, { x: 0, y: 3, width: 4, height: 9 }));
    expect(mask(0, 6) & 64).toBe(64);
    expect(mask(1, 11) & 16).toBe(16);
    expect(mask(3, 6) & 4).toBe(0);
    expect(mask(1, 3) & 1).toBe(0);
  });

  it("merges overlapping areas into one shape whose concave corners use inner-join masks", () => {
    const { store, stamp, mask } = fixture(20, 20);
    applySmartStampArea(store, stamp, { x: 8, y: 0, width: 3, height: 7 });
    const plan = planSmartStampArea(store.document, stamp, { x: 6, y: 5, width: 3, height: 10 }, { revision: store.revision });
    expect(plan.layers[0]!.writes.length).toBeGreaterThan(0);
    applySmartStampArea(store, stamp, { x: 6, y: 5, width: 3, height: 10 });
    expect(mask(8, 5)).toBe(255 & ~128);
    expect(mask(8, 6)).toBe(255 & ~8);
  });
});

describe("smart candidate discovery", () => {
  it("finds a bordered block inside a sparse sheet and rejects borderless texture", () => {
    const art = boundaryArt(0, 6, 6, 16, "water", 2, 0, { col: 2, row: 1, columns: 10, rows: 8 });
    expect(findSmartCandidates({ tileset: art.tileset, pixels: art.pixels!, emptyIds: new Set() })).toEqual([{ rect: { x: 2, y: 1, width: 6, height: 6 }, band: 2, kind: "road" }]);
    const texture = boundaryArt(1);
    expect(findSmartCandidates({ tileset: texture.tileset, pixels: texture.pixels!, emptyIds: new Set() })).toEqual([]);
  });

  it("is deterministic and bounded by its detector budget", () => {
    const art = boundaryArt(0, 6, 6, 16, "road", 2, 0, { columns: 7, rows: 7 });
    const input = { tileset: art.tileset, pixels: art.pixels!, emptyIds: new Set<number>() };
    expect(findSmartCandidates(input)).toEqual(findSmartCandidates(input));
    expect(findSmartCandidates(input, { maxDetections: 0 })).toEqual([]);
  });
});
