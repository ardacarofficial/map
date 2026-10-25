/** Aligned reference → per-cell matches (K4 engine). Pass 1 matches opaque ground with a free per-candidate gain;
 * confident cells give a light estimate that is smoothed over neighbours (gradients, glows). Pass 2 matches with
 * that local light fixed, layered overlays, and neighbours' grounds as hints under overlays. Pure (no DOM). */
import type { Rect, ReferenceAlignment } from "@smap/agent";
import type { RgbaImage } from "@smap/core";
import { cellCovered, sampleCell } from "./alignment";
import { estimateLight, matchResampled, type CellMatch, type Light } from "./matchCell";
import type { Resampled, TileIndex } from "./tileIndex";

export interface AlignedQuantizeInput {
  reference: RgbaImage; alignment: ReferenceAlignment; content: Rect; region: Rect;
  index: TileIndex; tileWidth: number; tileHeight: number;
  normalizeLight: boolean; layered: boolean; topK?: number;
  checkpoint?: () => Promise<void> | undefined;
}
export interface AlignedCell { covered: boolean; match: CellMatch | null; light?: Light }

const LIGHT_MAX_ERR = 12, LIGHT_MIN_CONFIDENCE = 0.25, LIGHT_MIN_TEXTURE = 2;
const median = (values: number[]) => { values.sort((a, b) => a - b); const m = values.length >> 1; return values.length % 2 ? values[m]! : (values[m - 1]! + values[m]!) / 2; };

/** Component-wise median of the light estimates within a growing neighbourhood. */
function smoothLight(estimates: (Light | undefined)[], W: number, H: number): (Light | undefined)[] {
  const all = estimates.filter((e): e is Light => !!e);
  if (!all.length) return estimates.map(() => undefined);
  const global = combine(all);
  return estimates.map((_, i) => {
    const x = i % W, y = Math.floor(i / W);
    for (const r of [1, 2, 4]) {
      const near: Light[] = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const e = estimates[ny * W + nx];
        if (e) near.push(e);
      }
      if (near.length >= (r === 1 ? 5 : r === 2 ? 4 : 3)) return combine(near);
    }
    return global;
  });
}
function combine(list: Light[]): Light {
  const pick = (f: (l: Light) => number) => median(list.map(f));
  return { gain: [pick(l => l.gain[0]), pick(l => l.gain[1]), pick(l => l.gain[2])], offset: [pick(l => l.offset[0]), pick(l => l.offset[1]), pick(l => l.offset[2])] };
}

export async function quantizeAligned(input: AlignedQuantizeInput): Promise<AlignedCell[]> {
  const { reference, alignment, content, region, index, tileWidth, tileHeight } = input;
  const W = region.width, H = region.height, topK = input.topK ?? 4;
  const pause = () => input.checkpoint?.();
  const patches: (Resampled | null)[] = [];
  for (let y = 0; y < H; y++) {
    { const w = pause(); if (w) await w; }
    for (let x = 0; x < W; x++) {
      const mx = region.x + x, my = region.y + y;
      patches.push(cellCovered(alignment, mx, my, tileWidth, tileHeight, content) ? sampleCell(reference, alignment, mx, my, tileWidth, tileHeight, index.size, content) : null);
    }
  }
  const twoPass = input.normalizeLight || input.layered;
  const first: (CellMatch | null)[] = [];
  if (twoPass) {
    for (let i = 0; i < patches.length; i++) {
      { const w = pause(); if (w) await w; }
      const p = patches[i];
      first.push(p ? matchResampled(p, index, { normalizeLight: input.normalizeLight, topK: 1 }) : null);
    }
  }
  let light: (Light | undefined)[] = patches.map(() => undefined);
  if (input.normalizeLight) {
    const estimates = first.map((m, i) => {
      if (!m || m.groundIndex < 0 || m.err > LIGHT_MAX_ERR || m.confidence < LIGHT_MIN_CONFIDENCE) return undefined;
      const tile = index.tiles[m.groundIndex]!;
      return tile.texture >= LIGHT_MIN_TEXTURE ? estimateLight(patches[i]!, tile) : undefined;
    });
    light = smoothLight(estimates, W, H);
  }
  const out: AlignedCell[] = [];
  for (let i = 0; i < patches.length; i++) {
    { const w = pause(); if (w) await w; }
    const p = patches[i];
    if (!p) { out.push({ covered: false, match: null }); continue; }
    if (!twoPass) { out.push({ covered: true, match: matchResampled(p, index, { topK }) }); continue; }
    const x = i % W, y = Math.floor(i / W), hints: number[] = [];
    if (input.layered) for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const m = first[ny * W + nx];
      if (m && m.groundIndex >= 0 && m.confidence >= 0.3 && !hints.includes(m.groundIndex)) hints.push(m.groundIndex);
      if (hints.length >= 4) break;
    }
    const l = light[i];
    out.push({ covered: true, match: matchResampled(p, index, { ...(l ? { light: l } : {}), layered: input.layered, topK, groundHints: hints }), ...(l ? { light: l } : {}) });
  }
  return out;
}
