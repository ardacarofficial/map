/**
 * Terrain templates (autotile) and terrain definitions.
 *
 * The user never writes rules (CLAUDE.md → Yapılmayacaklar). They mark a
 * block in a tileset as "this terrain" and pick one of two standard
 * templates; the template alone says which tile of the block goes where.
 * Layouts are documented in `samples/tilesets/TEMPLATES.md` as well.
 *
 * ## `corner16` — 2-corner Wang, 4×4 block
 *
 * Each tile shows the terrain in some of its four corners. Corner bits:
 * `NE = 1`, `SE = 2`, `SW = 4`, `NW = 8`. Slot (= mask) `s` sits at block
 * column `s % 4`, row `s >> 2` (row-major). Slot 0 is "no terrain in any
 * corner", slot 15 "terrain everywhere". Same layout as `wang16-32.png`.
 *
 * ## `blob47` — 47-tile blob, 8×6 block
 *
 * Each tile depends on the 8 neighbours. Direction bits (cr31 convention):
 * `N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128`.
 * A corner bit only counts when both of its edge bits are set
 * ({@link reduceBlobMask}); that leaves exactly 47 distinct masks. The block
 * lists those 47 reduced masks sorted ascending: slot = rank, at block
 * column `slot % 8`, row `slot >> 3`; the 48th cell (column 7, row 5) is
 * unused. Same layout as `blob47-32.png`.
 */
import type { Tileset } from "./tileset";

/** The two standard templates. */
export type TerrainTemplate = "corner16" | "blob47";

/** Block geometry of a template. */
export interface TerrainTemplateInfo {
  /** Block width in tiles. */
  readonly columns: number;
  /** Block height in tiles. */
  readonly rows: number;
  /** Number of used slots (tiles) in the block. */
  readonly slots: number;
}

/** Geometry of every template. */
export const TERRAIN_TEMPLATES: Readonly<Record<TerrainTemplate, TerrainTemplateInfo>> = Object.freeze({
  corner16: Object.freeze({ columns: 4, rows: 4, slots: 16 }),
  blob47: Object.freeze({ columns: 8, rows: 6, slots: 47 }),
});

/** True when `value` names a template. */
export function isTerrainTemplate(value: unknown): value is TerrainTemplate {
  return value === "corner16" || value === "blob47";
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

/** The 47 reduced masks, ascending. `BLOB47_MASKS[slot]` is the mask the slot's tile shows. */
export const BLOB47_MASKS: readonly number[] = Object.freeze(
  [...new Set(Array.from({ length: 256 }, (_, m) => reduceBlobMask(m)))].sort((a, b) => a - b),
);

/** Raw (unreduced) 8-neighbour mask → slot, for all 256 masks. */
const BLOB47_SLOT_OF_RAW: Uint8Array = (() => {
  const rank = new Map(BLOB47_MASKS.map((m, i) => [m, i]));
  const table = new Uint8Array(256);
  for (let m = 0; m < 256; m++) table[m] = rank.get(reduceBlobMask(m))!;
  return table;
})();

/** `blob47` slot for any 8-neighbour mask (reduced first). */
export function blob47Slot(mask: number): number {
  return BLOB47_SLOT_OF_RAW[mask & 255]!;
}

// ------------------------------------------------------------------ definitions

/** Highest value a grid cell (and so a terrain id) may hold. */
export const MAX_TERRAIN_ID = 0xffff;

/** Extra tiles for one template slot; one is picked per cell by `hash(seed, x, y)`. */
export interface TerrainVariant {
  /** Template slot (`0..15` for corner16 — equal to the corner mask; `0..46` for blob47 — rank of the reduced mask). */
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
  const info = TERRAIN_TEMPLATES[terrain.template];
  const col = terrain.origin.col + (slot % info.columns);
  const row = terrain.origin.row + Math.floor(slot / info.columns);
  return row * tileset.columns + col;
}

/**
 * Candidate tile ids per slot: `[base, ...variants]`. Index with the slot,
 * then pick with {@link pickVariant}.
 */
export function terrainCandidates(tileset: Tileset, terrain: Terrain): number[][] {
  const info = TERRAIN_TEMPLATES[terrain.template];
  const out: number[][] = [];
  for (let s = 0; s < info.slots; s++) out.push([terrainSlotTileId(tileset, terrain, s)]);
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
  const info = TERRAIN_TEMPLATES[terrain.template];
  if (col + info.columns > tileset.columns || row + info.rows > tileset.rows) {
    return `terrain ${terrain.id}: a ${info.columns}×${info.rows} ${terrain.template} block at (${col}, ${row}) does not fit in the ${tileset.columns}×${tileset.rows} tileset`;
  }
  if (terrain.variants !== undefined) {
    if (!Array.isArray(terrain.variants)) return `terrain ${terrain.id} variants must be an array`;
    const seen = new Set<number>();
    const count = tileset.columns * tileset.rows;
    for (const v of terrain.variants) {
      if (!Number.isInteger(v?.slot) || v.slot < 0 || v.slot >= info.slots) {
        return `terrain ${terrain.id}: variant slot must be an integer in [0, ${info.slots - 1}], got ${String(v?.slot)}`;
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
