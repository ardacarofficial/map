/**
 * Terrain templates (autotile) and terrain definitions.
 *
 * The user never writes rules (CLAUDE.md → Yapılmayacaklar). They mark a
 * block in a tileset as "this terrain" and pick a standard template; the
 * template alone says which tile of the block goes where. Layouts are
 * documented in `samples/tilesets/TEMPLATES.md` as well.
 *
 * A template belongs to a **family** (how a cell's mask is computed:
 * `corner16` or `blob47`) and fixes a **layout** (where each mask's tile sits
 * in the block). A **slot** is a block cell index, row-major:
 * slot `s` = block column `s % columns`, row `floor(s / columns)`. Every
 * template lists the mask each slot shows ({@link TerrainTemplateInfo.masks});
 * `null` marks an unused cell.
 *
 * ## `corner16` — 2-corner Wang, 4×4 block
 *
 * Each tile shows the terrain in some of its four corners. Corner bits:
 * `NE = 1`, `SE = 2`, `SW = 4`, `NW = 8`. Slot = mask. Same layout as
 * `wang16-32.png`.
 *
 * ## `blob47-*` — 47-tile blob
 *
 * Each tile depends on the 8 neighbours. Direction bits (cr31 convention):
 * `N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128`.
 * A corner bit only counts when both of its edge bits are set
 * ({@link reduceBlobMask}); that leaves exactly 47 distinct masks. Layouts:
 *
 * - `blob47-godot` (default for new terrains) — 12×4, the Godot 3 "3×3
 *   minimal" autotile template from the official Godot docs
 *   (`autotile_template_3x3_minimal.png`). The de-facto layout of
 *   ready-made blob tilesets. Cell (10, 1) is unused.
 * - `blob47-cr31` — 7×7, cr31's "blob" reference sheet (`wangbl.png`).
 *   Cells (6, 0) and (0, 6) repeat the empty tile and are unused.
 * - `blob47` — legacy "smap-sorted" 8×6: the 47 reduced masks sorted
 *   ascending (slot = rank), cell (7, 5) unused. No real tileset uses it;
 *   kept so v0.3 files keep working. Same layout as `blob47-32.png`.
 */
import type { Tileset } from "./tileset";

/** Every template id. `blob47` is the legacy sorted layout; see the module doc. */
export type TerrainTemplate = "corner16" | "blob47-godot" | "blob47-cr31" | "blob47";

/** How a template's masks are computed: corner Wang (4 bits) or 8-neighbour blob. */
export type TerrainTemplateFamily = "corner16" | "blob47";

/** One template: block geometry and the slot → mask table. */
export interface TerrainTemplateInfo {
  readonly id: TerrainTemplate;
  readonly family: TerrainTemplateFamily;
  /** Language-neutral display name (proper nouns and sizes only). */
  readonly name: string;
  /** Block width in tiles. */
  readonly columns: number;
  /** Block height in tiles. */
  readonly rows: number;
  /**
   * Mask shown by each block cell, row-major (index = slot, length =
   * `columns × rows`); `null` = unused cell. corner16: corner mask
   * (`NE 1, SE 2, SW 4, NW 8`); blob47: reduced 8-neighbour mask.
   */
  readonly masks: readonly (number | null)[];
  /** Number of used cells (16 or 47). */
  readonly slots: number;
  /** Kept only for old files; a template picker should hide it. */
  readonly legacy: boolean;
}

// ------------------------------------------------------------------ corner16

/** `corner16` corner bit: north-east corner has the terrain. */
export const CORNER_NE = 1;
/** `corner16` corner bit: south-east corner has the terrain. */
export const CORNER_SE = 2;
/** `corner16` corner bit: south-west corner has the terrain. */
export const CORNER_SW = 4;
/** `corner16` corner bit: north-west corner has the terrain. */
export const CORNER_NW = 8;

/** `corner16` slot for a corner mask (`NE*1 + SE*2 + SW*4 + NW*8`): the mask itself. */
export function corner16Slot(mask: number): number {
  return mask & 15;
}

// ------------------------------------------------------------------ blob47

/** `blob47` direction bit. */
export const BLOB_N = 1;
export const BLOB_NE = 2;
export const BLOB_E = 4;
export const BLOB_SE = 8;
export const BLOB_S = 16;
export const BLOB_SW = 32;
export const BLOB_W = 64;
export const BLOB_NW = 128;

/**
 * Drops corner bits whose two adjacent edge bits are not both set
 * (NE needs N and E, SE needs S and E, SW needs S and W, NW needs N and W).
 * Idempotent; maps all 256 masks onto the 47 of {@link BLOB47_MASKS}.
 */
export function reduceBlobMask(mask: number): number {
  let m = mask & 255;
  if ((m & (BLOB_N | BLOB_E)) !== (BLOB_N | BLOB_E)) m &= ~BLOB_NE;
  if ((m & (BLOB_S | BLOB_E)) !== (BLOB_S | BLOB_E)) m &= ~BLOB_SE;
  if ((m & (BLOB_S | BLOB_W)) !== (BLOB_S | BLOB_W)) m &= ~BLOB_SW;
  if ((m & (BLOB_N | BLOB_W)) !== (BLOB_N | BLOB_W)) m &= ~BLOB_NW;
  return m;
}

/**
 * The 47 reduced masks, ascending. Also the legacy `blob47` layout:
 * `BLOB47_MASKS[slot]` is the mask that slot's tile shows.
 */
export const BLOB47_MASKS: readonly number[] = Object.freeze(
  [...new Set(Array.from({ length: 256 }, (_, m) => reduceBlobMask(m)))].sort((a, b) => a - b),
);

/** Unused block cell in the tables below. */
const X = null;

/**
 * `blob47-godot`, 12×4. Decoded from the Godot 3.x docs image
 * `tutorials/2d/img/autotile_template_3x3_minimal.png` (identical in the
 * 3.2–3.6 branches of godot-docs; the "top-down floor" template uses the
 * same arrangement). Cell (10, 1) is blank in the source.
 */
const GODOT_MASKS: readonly (number | null)[] = [
  16, 20, 84, 80, 213,  92, 116,  87, 28, 125, 124, 112,
  17, 21, 85, 81,  29, 127, 253, 113, 31, 119,   X, 245,
   1,  5, 69, 65,  23, 223, 247, 209, 95, 255, 221, 241,
   0,  4, 68, 64, 117,  71, 197,  93,  7, 199, 215, 193,
];

/**
 * `blob47-cr31`, 7×7. cr31 "Blob" page (www.cr31.co.uk/stagecast/wang/blob.html,
 * mirrored by boristhebrave.com), image `art/atlas/blob/wangbl.png`: each
 * tile is labelled with its mask and the art agrees. Cells (6, 0) and
 * (0, 6) repeat tile 0 there; here they are unused.
 */
const CR31_MASKS: readonly (number | null)[] = [
   0,   4,  92, 124, 116,  80,  X,
  16,  20,  87, 223, 241,  21, 64,
  29, 117,  85,  71, 221, 125, 112,
  31, 253, 113,  28, 127, 247, 209,
  23, 199, 213,  95, 255, 245,  81,
   5,  84,  93, 119, 215, 193,  17,
   X,   1,   7, 197,  69,  68,  65,
];

function template(
  id: TerrainTemplate,
  family: TerrainTemplateFamily,
  name: string,
  columns: number,
  rows: number,
  masks: readonly (number | null)[],
  legacy = false,
): TerrainTemplateInfo {
  if (masks.length !== columns * rows) throw new Error(`template ${id}: mask table size`);
  return Object.freeze({
    id,
    family,
    name,
    columns,
    rows,
    masks: Object.freeze([...masks]),
    slots: masks.filter((m) => m !== null).length,
    legacy,
  });
}

/**
 * Every template, in picker order (most common first; legacy last).
 * Look one up with {@link terrainTemplateInfo}.
 */
export const TERRAIN_TEMPLATES: readonly TerrainTemplateInfo[] = Object.freeze([
  template("blob47-godot", "blob47", "Blob 47 · Godot 3×3 minimal (12×4)", 12, 4, GODOT_MASKS),
  template("blob47-cr31", "blob47", "Blob 47 · cr31 (7×7)", 7, 7, CR31_MASKS),
  template("corner16", "corner16", "Corner 16 · Wang (4×4)", 4, 4, Array.from({ length: 16 }, (_, i) => i)),
  template("blob47", "blob47", "Blob 47 · smap sorted (8×6, legacy)", 8, 6, [...BLOB47_MASKS, null], true),
]);

/** Template for new blob terrains: the layout most ready-made tilesets use. */
export const DEFAULT_TERRAIN_TEMPLATE: TerrainTemplate = "blob47-godot";

const TEMPLATE_BY_ID: ReadonlyMap<string, TerrainTemplateInfo> = new Map(TERRAIN_TEMPLATES.map((t) => [t.id, t]));

/** True when `value` names a template. */
export function isTerrainTemplate(value: unknown): value is TerrainTemplate {
  return typeof value === "string" && TEMPLATE_BY_ID.has(value);
}

/**
 * Descriptor of template `id`.
 * @throws Error for an unknown id.
 */
export function terrainTemplateInfo(id: TerrainTemplate): TerrainTemplateInfo {
  const info = TEMPLATE_BY_ID.get(id);
  if (!info) throw new Error(`unknown terrain template ${JSON.stringify(id)}`);
  return info;
}

/** Raw mask → slot table per template (256 entries for blob47, 16 for corner16). */
const SLOT_OF_MASK: ReadonlyMap<TerrainTemplate, Uint8Array> = new Map(
  TERRAIN_TEMPLATES.map((info) => {
    const slotOfMask = new Map<number, number>();
    info.masks.forEach((m, slot) => {
      if (m !== null && !slotOfMask.has(m)) slotOfMask.set(m, slot);
    });
    const size = info.family === "blob47" ? 256 : 16;
    const table = new Uint8Array(size);
    for (let m = 0; m < size; m++) {
      const key = info.family === "blob47" ? reduceBlobMask(m) : m;
      const slot = slotOfMask.get(key);
      if (slot === undefined) throw new Error(`template ${info.id}: no tile for mask ${key}`);
      table[m] = slot;
    }
    return [info.id, table];
  }),
);

/**
 * Slot (block cell) of `template` that shows `mask`. blob47 templates
 * take any 8-neighbour mask (reduced first); corner16 a corner mask.
 */
export function terrainSlotForMask(template: TerrainTemplate, mask: number): number {
  const table = SLOT_OF_MASK.get(template)!;
  return table[mask & (table.length - 1)]!;
}

/** Legacy `blob47` (sorted) slot for any 8-neighbour mask. Same as `terrainSlotForMask("blob47", mask)`. */
export function blob47Slot(mask: number): number {
  return terrainSlotForMask("blob47", mask);
}

// ------------------------------------------------------------------ definitions

/** Highest value a grid cell (and so a terrain id) may hold. */
export const MAX_TERRAIN_ID = 0xffff;

/** Extra tiles for one template slot; one is picked per cell by `hash(seed, x, y)`. */
export interface TerrainVariant {
  /** Template slot: block cell index, row-major. Must be a used cell of the template. */
  readonly slot: number;
  /** Alternative tile ids (anywhere in the same tileset). The block's own tile stays a candidate too. */
  readonly tileIds: readonly number[];
}

/**
 * A terrain: a block of a tileset laid out as a standard template.
 * Stored in its tileset's `terrains` list (project file).
 */
export interface Terrain {
  /** Value painted into terrain grid layers. Integer in `[1, MAX_TERRAIN_ID]`, unique in the project. */
  readonly id: number;
  readonly name: string;
  readonly tilesetId: string;
  readonly template: TerrainTemplate;
  /** Tileset grid position of the block's top-left tile. */
  readonly origin: { readonly col: number; readonly row: number };
  /** Optional alternatives per slot, sorted by slot. */
  readonly variants?: readonly TerrainVariant[];
}

/** Tile id of a template slot's base tile (the tile inside the block). */
export function terrainSlotTileId(tileset: Tileset, terrain: Terrain, slot: number): number {
  const info = terrainTemplateInfo(terrain.template);
  const col = terrain.origin.col + (slot % info.columns);
  const row = terrain.origin.row + Math.floor(slot / info.columns);
  return row * tileset.columns + col;
}

/**
 * Candidate tile ids per slot: `[base, ...variants]`. Index with the slot,
 * then pick with {@link pickVariant}. Unused cells get an empty list.
 */
export function terrainCandidates(tileset: Tileset, terrain: Terrain): number[][] {
  const info = terrainTemplateInfo(terrain.template);
  const out: number[][] = [];
  for (let s = 0; s < info.masks.length; s++) out.push(info.masks[s] === null ? [] : [terrainSlotTileId(tileset, terrain, s)]);
  for (const v of terrain.variants ?? []) out[v.slot]!.push(...v.tileIds);
  return out;
}

/**
 * Deterministic 32-bit hash of (`seed`, `x`, `y`) — murmur3-style mixing.
 * Never a sequential RNG: the same cell always gets the same value, so undo
 * and reopening never change which variant a cell shows.
 */
export function cellHash(seed: number, x: number, y: number): number {
  let h = seed >>> 0;
  h = mix(h, x | 0);
  h = mix(h, y | 0);
  h ^= 8;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function mix(h: number, k: number): number {
  k = Math.imul(k, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

/** Index into a candidate list of length `count` for cell (`x`, `y`). */
export function pickVariant(count: number, seed: number, x: number, y: number): number {
  return count <= 1 ? 0 : cellHash(seed, x, y) % count;
}

/**
 * Returns a copy with sorted, de-duplicated, frozen variants (empty ones
 * dropped; `variants` omitted when none are left).
 */
export function normalizeTerrain(terrain: Terrain): Terrain {
  const bySlot = new Map<number, number[]>();
  for (const v of terrain.variants ?? []) {
    const list = bySlot.get(v.slot) ?? [];
    for (const id of v.tileIds) if (!list.includes(id)) list.push(id);
    bySlot.set(v.slot, list);
  }
  const variants = [...bySlot]
    .filter(([, ids]) => ids.length > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([slot, ids]) => Object.freeze({ slot, tileIds: Object.freeze(ids) }));
  const base = {
    id: terrain.id,
    name: terrain.name,
    tilesetId: terrain.tilesetId,
    template: terrain.template,
    origin: Object.freeze({ col: terrain.origin.col, row: terrain.origin.row }),
  };
  return Object.freeze(variants.length > 0 ? { ...base, variants: Object.freeze(variants) } : base);
}

/**
 * What is wrong with `terrain` as a terrain of `tileset`, or `null`.
 * Checks the id range, template, that the whole block fits inside the
 * tileset grid and that variant slots / tile ids are valid.
 */
export function terrainProblem(tileset: Tileset, terrain: Terrain): string | null {
  if (typeof terrain !== "object" || terrain === null) return "terrain must be an object";
  if (!Number.isInteger(terrain.id) || terrain.id < 1 || terrain.id > MAX_TERRAIN_ID) {
    return `terrain id must be an integer in [1, ${MAX_TERRAIN_ID}], got ${String(terrain.id)}`;
  }
  if (typeof terrain.name !== "string") return "terrain name must be a string";
  if (terrain.tilesetId !== tileset.id) {
    return `terrain ${terrain.id} belongs to tileset "${String(terrain.tilesetId)}", not "${tileset.id}"`;
  }
  if (!isTerrainTemplate(terrain.template)) return `unknown terrain template ${JSON.stringify(terrain.template)}`;
  const origin = terrain.origin as { col?: unknown; row?: unknown } | null | undefined;
  const col = origin?.col;
  const row = origin?.row;
  if (typeof col !== "number" || typeof row !== "number" || !Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0) {
    return `terrain ${terrain.id} origin must be non-negative integers`;
  }
  const info = terrainTemplateInfo(terrain.template);
  if (col + info.columns > tileset.columns || row + info.rows > tileset.rows) {
    return `terrain ${terrain.id}: a ${info.columns}×${info.rows} ${terrain.template} block at (${col}, ${row}) does not fit in the ${tileset.columns}×${tileset.rows} tileset`;
  }
  if (terrain.variants !== undefined) {
    if (!Array.isArray(terrain.variants)) return `terrain ${terrain.id} variants must be an array`;
    const seen = new Set<number>();
    const count = tileset.columns * tileset.rows;
    for (const v of terrain.variants) {
      if (!Number.isInteger(v?.slot) || v.slot < 0 || v.slot >= info.masks.length || info.masks[v.slot] === null) {
        return `terrain ${terrain.id}: variant slot must be a used cell of the ${terrain.template} block, got ${String(v?.slot)}`;
      }
      if (seen.has(v.slot)) return `terrain ${terrain.id}: duplicate variant slot ${v.slot}`;
      seen.add(v.slot);
      if (!Array.isArray(v.tileIds)) return `terrain ${terrain.id}: variant tileIds must be an array`;
      for (const id of v.tileIds) {
        if (!Number.isInteger(id) || id < 0 || id >= count) {
          return `terrain ${terrain.id}: variant tile id ${String(id)} is outside the tileset`;
        }
      }
    }
  }
  return null;
}
