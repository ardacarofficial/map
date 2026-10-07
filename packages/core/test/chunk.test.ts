import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CHUNK_SIZE,
  TileLayer,
  chunkCoord,
  chunkKey,
  localCoord,
  localIndex,
  parseChunkKey,
} from "../src";

describe("chunk addressing", () => {
  it("matches floor division and positive modulo, including negatives", () => {
    fc.assert(
      fc.property(fc.integer({ min: -(2 ** 30), max: 2 ** 30 }), (x) => {
        expect(chunkCoord(x)).toBe(Math.floor(x / CHUNK_SIZE));
        expect(localCoord(x)).toBe(((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE);
        expect(chunkCoord(x) * CHUNK_SIZE + localCoord(x)).toBe(x);
      }),
    );
  });

  it("known negative cases", () => {
    expect(chunkCoord(-1)).toBe(-1);
    expect(localCoord(-1)).toBe(31);
    expect(chunkCoord(-32)).toBe(-1);
    expect(chunkCoord(-33)).toBe(-2);
    expect(localCoord(-33)).toBe(31);
  });

  it("chunk keys roundtrip", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e6, max: 1e6 }), fc.integer({ min: -1e6, max: 1e6 }), (cx, cy) => {
        expect(parseChunkKey(chunkKey(cx, cy))).toEqual({ cx, cy });
      }),
    );
  });

  it("local index is row-major", () => {
    expect(localIndex(0, 0)).toBe(0);
    expect(localIndex(31, 0)).toBe(31);
    expect(localIndex(0, 1)).toBe(32);
    expect(localIndex(31, 31)).toBe(1023);
  });
});

describe("sparse tile layer", () => {
  const props = { id: "l", name: "L", visible: true, locked: false, opacity: 1 };

  it("creates no chunk for empty writes and reads empty everywhere", () => {
    const layer = new TileLayer(props);
    expect(layer._setCell(5, 5, 0)).toBe(0);
    expect(layer.chunkCount).toBe(0);
    expect(layer.getCell(-100, 7)).toBe(0);
  });

  it("creates a chunk on first write and removes it when emptied", () => {
    const layer = new TileLayer(props);
    layer._setCell(33, 2, 7);
    layer._setCell(34, 2, 8);
    expect(layer.chunkCount).toBe(1);
    expect(layer.getChunk(1, 0)?.filled).toBe(2);
    expect(layer.getCell(33, 2)).toBe(7);
    layer._setCell(33, 2, 0);
    expect(layer.chunkCount).toBe(1);
    layer._setCell(34, 2, 0);
    expect(layer.chunkCount).toBe(0);
    expect(layer.getChunk(1, 0)).toBeUndefined();
  });

  it("works with negative coordinates", () => {
    const layer = new TileLayer(props);
    layer._setCell(-1, -1, 9);
    expect(layer.getChunk(-1, -1)?.data[1023]).toBe(9);
    expect(layer.getCell(-1, -1)).toBe(9);
    expect(layer.getCell(31, 31)).toBe(0);
  });

  it("matches a reference map under random writes; chunk count = non-empty chunks", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: -70, max: 70 }),
            y: fc.integer({ min: -70, max: 70 }),
            cell: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 5 })),
          }),
          { maxLength: 300 },
        ),
        (writes) => {
          const layer = new TileLayer(props);
          const ref = new Map<string, number>();
          for (const { x, y, cell } of writes) {
            const before = layer._setCell(x, y, cell);
            expect(before).toBe(ref.get(`${x},${y}`) ?? 0);
            if (cell === 0) ref.delete(`${x},${y}`);
            else ref.set(`${x},${y}`, cell);
          }
          for (const [key, cell] of ref) {
            const [x, y] = key.split(",").map(Number) as [number, number];
            expect(layer.getCell(x, y)).toBe(cell);
          }
          const expectedChunks = new Set(
            [...ref.keys()].map((k) => {
              const [x, y] = k.split(",").map(Number) as [number, number];
              return chunkKey(x >> 5, y >> 5);
            }),
          );
          expect(new Set([...layer.chunks()].map((c) => c.key))).toEqual(expectedChunks);
          for (const chunk of layer.chunks()) {
            expect(chunk.filled).toBe(chunk.data.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0));
          }
        },
      ),
    );
  });
});
