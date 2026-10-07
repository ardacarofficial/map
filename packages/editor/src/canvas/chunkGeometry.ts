/**
 * Pure chunk → quad geometry. One chunk becomes one quad batch per texture
 * (atlas page); with a single tileset that is one mesh, one draw call.
 */
import { CELL_INDEX_MASK, CHUNK_SHIFT, CHUNK_SIZE, FLIP_H, FLIP_V } from "@smap/core";

/** Where a palette index is drawn from. `group` identifies the texture (atlas page). */
export interface QuadSource {
  readonly group: number;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

/** Resolves a palette index; `undefined` when not drawable yet (e.g. image not loaded). */
export type QuadResolver = (paletteIndex: number) => QuadSource | undefined;

export interface QuadBatch {
  readonly group: number;
  readonly quads: number;
  /** x,y per vertex, chunk-local world px. 4 vertices per quad: TL, TR, BR, BL. */
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  /** Two triangles per quad. */
  readonly indices: Uint32Array;
}

/**
 * Builds quads for a chunk's 32×32 cells. Positions are local to the chunk
 * origin (cell (0,0) of the chunk at (0,0)); each cell is `tileW`×`tileH`.
 * Empty cells and unresolved palette indices produce no quad. FLIP_H / FLIP_V
 * swap the UVs. Batches are ordered by `group`.
 */
export function buildChunkQuads(
  data: ArrayLike<number>,
  tileW: number,
  tileH: number,
  resolve: QuadResolver,
): QuadBatch[] {
  const n = Math.min(data.length, CHUNK_SIZE * CHUNK_SIZE);
  const sources: (QuadSource | undefined)[] = new Array<QuadSource | undefined>(n);
  const counts = new Map<number, number>();
  const cache = new Map<number, QuadSource | undefined>();
  for (let i = 0; i < n; i++) {
    const cell = data[i]! >>> 0;
    if (cell === 0) continue;
    const index = cell & CELL_INDEX_MASK;
    let src: QuadSource | undefined;
    if (cache.has(index)) src = cache.get(index);
    else {
      src = resolve(index);
      cache.set(index, src);
    }
    if (!src) continue;
    sources[i] = src;
    counts.set(src.group, (counts.get(src.group) ?? 0) + 1);
  }

  const batches = new Map<number, { quads: number; filled: number; positions: Float32Array; uvs: Float32Array; indices: Uint32Array }>();
  for (const group of [...counts.keys()].sort((a, b) => a - b)) {
    const quads = counts.get(group)!;
    batches.set(group, {
      quads,
      filled: 0,
      positions: new Float32Array(quads * 8),
      uvs: new Float32Array(quads * 8),
      indices: new Uint32Array(quads * 6),
    });
  }

  for (let i = 0; i < n; i++) {
    const src = sources[i];
    if (!src) continue;
    const b = batches.get(src.group)!;
    const cell = data[i]! >>> 0;
    const lx = i & (CHUNK_SIZE - 1);
    const ly = i >> CHUNK_SHIFT;
    const x0 = lx * tileW;
    const y0 = ly * tileH;
    const x1 = x0 + tileW;
    const y1 = y0 + tileH;
    let { u0, u1, v0, v1 } = src;
    if ((cell & FLIP_H) !== 0) [u0, u1] = [u1, u0];
    if ((cell & FLIP_V) !== 0) [v0, v1] = [v1, v0];
    // TODO(v0.6): FLIP_D (diagonal flip) — swap the UV axes. Not produced by the editor yet.
    const q = b.filled++;
    const p = q * 8;
    const pos = b.positions;
    pos[p] = x0; pos[p + 1] = y0; pos[p + 2] = x1; pos[p + 3] = y0;
    pos[p + 4] = x1; pos[p + 5] = y1; pos[p + 6] = x0; pos[p + 7] = y1;
    const uv = b.uvs;
    uv[p] = u0; uv[p + 1] = v0; uv[p + 2] = u1; uv[p + 3] = v0;
    uv[p + 4] = u1; uv[p + 5] = v1; uv[p + 6] = u0; uv[p + 7] = v1;
    const v = q * 4;
    const ix = b.indices;
    const k = q * 6;
    ix[k] = v; ix[k + 1] = v + 1; ix[k + 2] = v + 2;
    ix[k + 3] = v; ix[k + 4] = v + 2; ix[k + 5] = v + 3;
  }

  return [...batches].map(([group, b]) => ({
    group,
    quads: b.quads,
    positions: b.positions,
    uvs: b.uvs,
    indices: b.indices,
  }));
}

/** A free-standing tile for {@link buildCellQuads}: cell position, flip bits, and its source. */
export interface CellQuad {
  readonly x: number;
  readonly y: number;
  readonly flags: number;
  readonly src: QuadSource;
}

/**
 * Quads for arbitrary cells (previews: stamps, rectangles). Positions are
 * `x * tileW`, `y * tileH` relative to the caller's origin. Later cells are
 * drawn over earlier ones within a batch. Batches are ordered by `group`.
 */
export function buildCellQuads(cells: readonly CellQuad[], tileW: number, tileH: number): QuadBatch[] {
  const counts = new Map<number, number>();
  for (const c of cells) counts.set(c.src.group, (counts.get(c.src.group) ?? 0) + 1);
  const out: QuadBatch[] = [];
  for (const group of [...counts.keys()].sort((a, b) => a - b)) {
    const quads = counts.get(group)!;
    const positions = new Float32Array(quads * 8);
    const uvs = new Float32Array(quads * 8);
    const indices = new Uint32Array(quads * 6);
    let q = 0;
    for (const c of cells) {
      if (c.src.group !== group) continue;
      let { u0, u1, v0, v1 } = c.src;
      if ((c.flags & FLIP_H) !== 0) [u0, u1] = [u1, u0];
      if ((c.flags & FLIP_V) !== 0) [v0, v1] = [v1, v0];
      const x0 = c.x * tileW;
      const y0 = c.y * tileH;
      const x1 = x0 + tileW;
      const y1 = y0 + tileH;
      const p = q * 8;
      positions.set([x0, y0, x1, y0, x1, y1, x0, y1], p);
      uvs.set([u0, v0, u1, v0, u1, v1, u0, v1], p);
      const v = q * 4;
      indices.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
      q++;
    }
    out.push({ group, quads, positions, uvs, indices });
  }
  return out;
}
