import { FLIP_H, FLIP_V, makeCell } from "@smap/core";
import { describe, expect, it } from "vitest";

import { buildChunkQuads, type QuadSource } from "./chunkGeometry";

const src = (group: number, u0 = 0, v0 = 0, u1 = 1, v1 = 1): QuadSource => ({ group, u0, v0, u1, v1 });

describe("buildChunkQuads", () => {
  it("emits nothing for an empty chunk", () => {
    expect(buildChunkQuads(new Uint32Array(1024), 32, 32, () => src(0))).toEqual([]);
  });

  it("builds one quad per drawable cell at the cell's local position", () => {
    const data = new Uint32Array(1024);
    data[0] = makeCell(1);
    data[33] = makeCell(1); // (1, 1)
    data[1023] = makeCell(1); // (31, 31)
    const [b, ...rest] = buildChunkQuads(data, 32, 16, () => src(0, 0.1, 0.2, 0.3, 0.4));
    expect(rest).toEqual([]);
    expect(b!.quads).toBe(3);
    expect(Array.from(b!.positions.slice(0, 8))).toEqual([0, 0, 32, 0, 32, 16, 0, 16]);
    expect(Array.from(b!.positions.slice(8, 16))).toEqual([32, 16, 64, 16, 64, 32, 32, 32]);
    expect(Array.from(b!.positions.slice(16, 24))).toEqual([992, 496, 1024, 496, 1024, 512, 992, 512]);
    expect(Array.from(b!.uvs.slice(0, 8))).toEqual(Array.from(new Float32Array([0.1, 0.2, 0.3, 0.2, 0.3, 0.4, 0.1, 0.4])));
    expect(Array.from(b!.indices)).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
  });

  it("groups quads by texture and skips unresolved indices", () => {
    const data = new Uint32Array(1024);
    data[0] = makeCell(1);
    data[1] = makeCell(2);
    data[2] = makeCell(3);
    data[3] = makeCell(2);
    const calls: number[] = [];
    const batches = buildChunkQuads(data, 32, 32, (i) => {
      calls.push(i);
      return i === 3 ? undefined : src(i === 1 ? 5 : 2);
    });
    expect(batches.map((b) => [b.group, b.quads])).toEqual([
      [2, 2],
      [5, 1],
    ]);
    expect(calls).toEqual([1, 2, 3]); // resolved once per palette index
  });

  it("swaps UVs for FLIP_H and FLIP_V", () => {
    const data = new Uint32Array(1024);
    data[0] = makeCell(1, FLIP_H);
    data[1] = makeCell(1, FLIP_V);
    data[2] = makeCell(1, FLIP_H | FLIP_V);
    const [b] = buildChunkQuads(data, 32, 32, () => src(0, 0, 0, 1, 1));
    expect(Array.from(b!.uvs.slice(0, 8))).toEqual([1, 0, 0, 0, 0, 1, 1, 1]);
    expect(Array.from(b!.uvs.slice(8, 16))).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
    expect(Array.from(b!.uvs.slice(16, 24))).toEqual([1, 1, 0, 1, 0, 0, 1, 0]);
  });
});
