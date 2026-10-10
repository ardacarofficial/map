/**
 * Template auto-detection: given the tileset image's pixels and a rough
 * selection, find which standard template (and where exactly) the block is
 * laid out in, so the user only drags roughly over the block and the
 * tagging macro (`tagBlockWithTemplate`) does the rest. Pure: works on an
 * RGBA byte array, no DOM.
 *
 * ## How a candidate is scored
 *
 * Every tile is split into four quadrants (NW, NE, SE, SW). In a correctly
 * placed template, a quadrant's look is decided by a few bits of the tile's
 * template mask:
 *
 * - corner16: the quadrant's own corner bit (terrain or background);
 * - blob47: the quadrant's two edge bits and its corner bit, giving five
 *   states (outer corner, vertical edge, horizontal edge, inner corner, full).
 *
 * So quadrants with the same (position, state) should look alike — the
 * "full" quadrants all like the full tile, the "background" ones like the
 * background, the edges like each other. The score is the share of pixel
 * variance that this grouping explains (an adjusted R²): about 0 for a
 * wrong template or offset (groups mix unrelated pixels), close to 1 for
 * the right one. Quadrants are compared on a 4×4 grid of average
 * premultiplied RGBA, so small noise and anti-aliasing do not matter.
 */
import { BLOB_E, BLOB_N, BLOB_NE, BLOB_NW, BLOB_S, BLOB_SE, BLOB_SW, BLOB_W, CORNER_NE, CORNER_NW, CORNER_SE, CORNER_SW, TERRAIN_TEMPLATES, type TerrainTemplate, type TerrainTemplateInfo } from "./terrain";
import { tileRect, type Tileset } from "./tileset";

/** Decoded image pixels: `width × height` RGBA bytes, row-major. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

/** A rough selection in tileset grid cells. */
export interface TileGridRect {
  readonly col: number;
  readonly row: number;
  readonly columns: number;
  readonly rows: number;
}

/** One candidate: template + block origin, with its score (higher = better, ≤ 1). */
export interface DetectedTerrainBlock {
  readonly template: TerrainTemplate;
  readonly origin: { readonly col: number; readonly row: number };
  readonly score: number;
}

/** Options of {@link detectTerrainBlock}. */
export interface DetectTerrainOptions {
  /** How many tiles around the rough selection origins may lie. Default 2. */
  readonly slack?: number;
  /** Also try the legacy `blob47` layout. Default false. */
  readonly includeLegacy?: boolean;
  /** Only try these templates. Default: all (non-legacy unless `includeLegacy`). */
  readonly templates?: readonly TerrainTemplate[];
}

/** Samples per quadrant side. */
const GRID = 4;
/** Features per quadrant (GRID² cells × RGBA). */
const FEATURES = GRID * GRID * 4;

/**
 * Candidate template blocks around `rough`, best first. Each template is
 * tried at every origin within `slack` tiles of the selection where the
 * whole block fits in the tileset. Candidates whose pixels carry no
 * information (e.g. fully transparent) score 0. Ties keep template order,
 * then the origin closest to the selection.
 */
export function detectTerrainBlock(
  tileset: Tileset,
  image: RgbaImage,
  rough: TileGridRect,
  options: DetectTerrainOptions = {},
): DetectedTerrainBlock[] {
  const slack = options.slack ?? 2;
  const templates = TERRAIN_TEMPLATES.filter((t) =>
    options.templates ? options.templates.includes(t.id) : options.includeLegacy || !t.legacy,
  );
  const features = new QuadrantFeatures(tileset, image);
  const out: { block: DetectedTerrainBlock; order: number; offset: number }[] = [];
  templates.forEach((info, order) => {
    const a = rough.col;
    const b = rough.col + rough.columns - info.columns;
    const c = rough.row;
    const d = rough.row + rough.rows - info.rows;
    const colMin = Math.max(0, Math.min(a, b) - slack);
    const colMax = Math.min(tileset.columns - info.columns, Math.max(a, b) + slack);
    const rowMin = Math.max(0, Math.min(c, d) - slack);
    const rowMax = Math.min(tileset.rows - info.rows, Math.max(c, d) + slack);
    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const score = scoreBlock(features, tileset, info, col, row);
        const offset = Math.abs(col - rough.col) + Math.abs(row - rough.row);
        out.push({ block: Object.freeze({ template: info.id, origin: Object.freeze({ col, row }), score }), order, offset });
      }
    }
  });
  out.sort((x, y) => y.block.score - x.block.score || x.order - y.order || x.offset - y.offset);
  return out.map((o) => o.block);
}

/** Quadrant state used for grouping (see the module doc). */
function quadrantState(info: TerrainTemplateInfo, mask: number, q: number): number {
  if (info.family === "corner16") {
    const bit = [CORNER_NW, CORNER_NE, CORNER_SE, CORNER_SW][q]!;
    return (mask & bit) !== 0 ? 1 : 0;
  }
  const [e1, e2, c] = [
    [BLOB_N, BLOB_W, BLOB_NW],
    [BLOB_N, BLOB_E, BLOB_NE],
    [BLOB_S, BLOB_E, BLOB_SE],
    [BLOB_S, BLOB_W, BLOB_SW],
  ][q]!;
  const h = (mask & e1) !== 0;
  const v = (mask & e2) !== 0;
  if (h && v) return (mask & c) !== 0 ? 4 : 3;
  return (h ? 1 : 0) | (v ? 2 : 0);
}

function scoreBlock(features: QuadrantFeatures, tileset: Tileset, info: TerrainTemplateInfo, col: number, row: number): number {
  const groups = new Map<number, number[]>(); // group key → indices into `vectors`
  const vectors: Float64Array[] = [];
  info.masks.forEach((mask, slot) => {
    if (mask === null) return;
    const tileId = (row + Math.floor(slot / info.columns)) * tileset.columns + col + (slot % info.columns);
    for (let q = 0; q < 4; q++) {
      const key = q * 8 + quadrantState(info, mask, q);
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(vectors.length);
      vectors.push(features.get(tileId, q));
    }
  });
  const n = vectors.length;
  const g = groups.size;
  if (n <= g || g < 2) return 0;
  const mean = new Float64Array(FEATURES);
  for (const v of vectors) for (let k = 0; k < FEATURES; k++) mean[k]! += v[k]! / n;
  let total = 0;
  for (const v of vectors) for (let k = 0; k < FEATURES; k++) total += (v[k]! - mean[k]!) ** 2;
  if (total < 1e-6 * n) return 0;
  let within = 0;
  const gm = new Float64Array(FEATURES);
  for (const list of groups.values()) {
    gm.fill(0);
    for (const i of list) for (let k = 0; k < FEATURES; k++) gm[k]! += vectors[i]![k]! / list.length;
    for (const i of list) for (let k = 0; k < FEATURES; k++) within += (vectors[i]![k]! - gm[k]!) ** 2;
  }
  return 1 - within / (n - g) / (total / (n - 1));
}

/** Lazily computed quadrant feature vectors per tile. */
class QuadrantFeatures {
  readonly #tileset: Tileset;
  readonly #image: RgbaImage;
  readonly #cache = new Map<number, Float64Array>();

  constructor(tileset: Tileset, image: RgbaImage) {
    this.#tileset = tileset;
    this.#image = image;
  }

  get(tileId: number, q: number): Float64Array {
    const key = tileId * 4 + q;
    let f = this.#cache.get(key);
    if (!f) {
      f = this.#compute(tileId, q);
      this.#cache.set(key, f);
    }
    return f;
  }

  #compute(tileId: number, q: number): Float64Array {
    const { width, height, data } = this.#image;
    const rect = tileRect(this.#tileset, tileId);
    const qw = rect.width / 2;
    const qh = rect.height / 2;
    const qx = rect.x + (q === 1 || q === 2 ? qw : 0);
    const qy = rect.y + (q >= 2 ? qh : 0);
    const out = new Float64Array(FEATURES);
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const x0 = Math.floor(qx + (gx * qw) / GRID);
        const x1 = Math.max(x0 + 1, Math.floor(qx + ((gx + 1) * qw) / GRID));
        const y0 = Math.floor(qy + (gy * qh) / GRID);
        const y1 = Math.max(y0 + 1, Math.floor(qy + ((gy + 1) * qh) / GRID));
        let r = 0;
        let gr = 0;
        let b = 0;
        let a = 0;
        let count = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            count++;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const p = (y * width + x) * 4;
            const alpha = data[p + 3]! / 255;
            r += (data[p]! / 255) * alpha;
            gr += (data[p + 1]! / 255) * alpha;
            b += (data[p + 2]! / 255) * alpha;
            a += alpha;
          }
        }
        const o = (gy * GRID + gx) * 4;
        out[o] = r / count;
        out[o + 1] = gr / count;
        out[o + 2] = b / count;
        out[o + 3] = a / count;
      }
    }
    return out;
  }
}
