/**
 * Terrain sets: terrain information as **tags on tileset tiles** (the
 * Tiled Wang-set / Godot terrain model; CLAUDE.md → Veri kararları ›
 * Autotile, October 2026).
 *
 * The real data is the tiles on an ordinary tile layer. A terrain set only
 * says, per tile, which terrain sits where:
 *
 * - `kind: "corner"` — each tagged tile lists the terrain on its four
 *   corners `[nw, ne, se, sw]` (terrain id, or 0 = none). Neighbouring
 *   tiles share corners (vertices), so several terrains of one set can meet
 *   and transition into each other (grass / dirt / water ...).
 * - `kind: "blob"` — each tagged tile belongs to one terrain (`terrainId`)
 *   and shows an 8-neighbour `mask` (cr31 bits `N 1, NE 2, E 4, SE 8, S 16,
 *   SW 32, W 64, NW 128`, stored reduced, see `reduceBlobMask`). A blob
 *   terrain is drawn "over anything else".
 *
 * The user never writes rules: the standard templates (`corner16`,
 * `blob47-godot`, `blob47-cr31`, legacy `blob47`) are **tagging macros**
 * ({@link tagBlockWithTemplate}) that fill in the tags of a block at once.
 * `detectTerrainBlock` (terrainDetect.ts) finds template and origin from
 * the pixels. The brush (`terrainBrush.ts`) reads the tags of the tiles
 * already on the layer and writes plain cells, so undo, export and
 * collision see nothing new.
 *
 * A tile without a tag in the set ("manual" tile) is never changed by the
 * brush unless the brush paints that very cell.
 */
import {
  BLOB_E,
  BLOB_N,
  BLOB_NE,
  BLOB_NW,
  BLOB_S,
  BLOB_SE,
  BLOB_SW,
  BLOB_W,
  CORNER_NE,
  CORNER_NW,
  CORNER_SE,
  CORNER_SW,
  reduceBlobMask,
  terrainTemplateInfo,
  type Terrain,
  type TerrainTemplate,
} from "./terrain";
import type { Tileset } from "./tileset";

/** How a terrain set's tiles are tagged: per corner, or per tile with an 8-neighbour mask. */
export type TerrainSetKind = "corner" | "blob";

/** Largest terrain id inside one set. */
export const MAX_SET_TERRAIN_ID = 255;

/** One terrain of a set (e.g. "Grass"). */
export interface TerrainSetTerrain {
  /** Integer in `[1, MAX_SET_TERRAIN_ID]`, unique in the set. 0 means "no terrain". */
  readonly id: number;
  readonly name: string;
  /** Display colour `#rrggbb` (lowercase). */
  readonly color: string;
}

/** Corners of a tile: `[nw, ne, se, sw]`, each a terrain id of the set or 0. */
export type TerrainCorners = readonly [number, number, number, number];

/** Terrain tag of one tile in one set. */
export interface TerrainTileTag {
  readonly tileId: number;
  /** Corner sets: terrain per corner `[nw, ne, se, sw]`. */
  readonly corners?: TerrainCorners;
  /** Blob sets: terrain this tile belongs to. */
  readonly terrainId?: number;
  /** Blob sets: reduced 8-neighbour mask the tile shows. */
  readonly mask?: number;
}

/** A terrain set of a tileset. Stored in the tileset's `terrainSets` list (project file). */
export interface TerrainSet {
  /** Unique within its tileset (`[A-Za-z0-9_-]`-ish; any non-empty string is accepted). */
  readonly id: string;
  readonly name: string;
  readonly kind: TerrainSetKind;
  /** Terrains, sorted by id. */
  readonly terrains: readonly TerrainSetTerrain[];
  /** Tagged tiles, sorted by tile id, at most one tag per tile. */
  readonly tiles: readonly TerrainTileTag[];
  /**
   * Terrain the eraser leaves behind (corner sets: the corners' terrain;
   * blob sets: the cells' terrain). Missing / 0 = empty cells.
   */
  readonly background?: number;
}

/** Colours given to terrains created without one (legacy migration, macros). */
export const TERRAIN_COLORS: readonly string[] = Object.freeze([
  "#5fb85f",
  "#b5895a",
  "#4f8fd6",
  "#d6c35a",
  "#9a6fd6",
  "#d65f5f",
  "#5fc8c8",
  "#8c8c8c",
]);

/** Default colour for terrain `id` (cycles through {@link TERRAIN_COLORS}). */
export function defaultTerrainColor(id: number): string {
  return TERRAIN_COLORS[(Math.max(1, Math.floor(id)) - 1) % TERRAIN_COLORS.length]!;
}

// ------------------------------------------------------------------ normalize / validate

/** Frozen copy with terrains sorted by id, tiles sorted by tile id, canonical optional fields. */
export function normalizeTerrainSet(set: TerrainSet): TerrainSet {
  const terrains = [...set.terrains]
    .map((t) => Object.freeze({ id: t.id, name: t.name, color: t.color.toLowerCase() }))
    .sort((a, b) => a.id - b.id);
  const byTile = new Map<number, TerrainTileTag>();
  for (const tag of set.tiles) byTile.set(tag.tileId, tag);
  const tiles = [...byTile.values()]
    .sort((a, b) => a.tileId - b.tileId)
    .map((tag) =>
      Object.freeze(
        set.kind === "corner"
          ? { tileId: tag.tileId, corners: Object.freeze([...(tag.corners ?? [0, 0, 0, 0])]) as unknown as TerrainCorners }
          : { tileId: tag.tileId, terrainId: tag.terrainId ?? 0, mask: reduceBlobMask(tag.mask ?? 0) },
      ),
    );
  return Object.freeze({
    id: set.id,
    name: set.name,
    kind: set.kind,
    terrains: Object.freeze(terrains),
    tiles: Object.freeze(tiles),
    ...(set.background ? { background: set.background } : {}),
  });
}

/** What is wrong with `set` as a terrain set of `tileset`, or `null`. */
export function terrainSetProblem(tileset: Tileset, set: TerrainSet): string | null {
  if (typeof set !== "object" || set === null) return "terrain set must be an object";
  if (typeof set.id !== "string" || set.id.length === 0) return "terrain set id must be a non-empty string";
  const where = `terrain set "${set.id}"`;
  if (typeof set.name !== "string") return `${where}: name must be a string`;
  if (set.kind !== "corner" && set.kind !== "blob") return `${where}: kind must be "corner" or "blob"`;
  if (!Array.isArray(set.terrains)) return `${where}: terrains must be an array`;
  const ids = new Set<number>();
  for (const t of set.terrains) {
    if (!Number.isInteger(t?.id) || t.id < 1 || t.id > MAX_SET_TERRAIN_ID) {
      return `${where}: terrain id must be an integer in [1, ${MAX_SET_TERRAIN_ID}], got ${String(t?.id)}`;
    }
    if (ids.has(t.id)) return `${where}: duplicate terrain id ${t.id}`;
    ids.add(t.id);
    if (typeof t.name !== "string") return `${where}: terrain ${t.id} name must be a string`;
    if (typeof t.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(t.color)) return `${where}: terrain ${t.id} color must be "#rrggbb"`;
  }
  if (set.background !== undefined && set.background !== 0 && !ids.has(set.background)) {
    return `${where}: background ${String(set.background)} is not a terrain of the set`;
  }
  if (!Array.isArray(set.tiles)) return `${where}: tiles must be an array`;
  const count = tileset.columns * tileset.rows;
  const seen = new Set<number>();
  for (const tag of set.tiles) {
    if (!Number.isInteger(tag?.tileId) || tag.tileId < 0 || tag.tileId >= count) {
      return `${where}: tile id ${String(tag?.tileId)} is outside the tileset`;
    }
    if (seen.has(tag.tileId)) return `${where}: tile ${tag.tileId} is tagged twice`;
    seen.add(tag.tileId);
    if (set.kind === "corner") {
      if (!Array.isArray(tag.corners) || tag.corners.length !== 4) return `${where}: tile ${tag.tileId} needs four corners`;
      for (const c of tag.corners) {
        if (c !== 0 && !ids.has(c)) return `${where}: tile ${tag.tileId} corner ${String(c)} is not a terrain of the set`;
      }
      if (tag.terrainId !== undefined || tag.mask !== undefined) return `${where}: corner tags have no terrainId / mask`;
    } else {
      if (!ids.has(tag.terrainId!)) return `${where}: tile ${tag.tileId} terrainId ${String(tag.terrainId)} is not a terrain of the set`;
      if (!Number.isInteger(tag.mask) || tag.mask! < 0 || tag.mask! > 255) return `${where}: tile ${tag.tileId} mask must be an integer in [0, 255]`;
      if (tag.corners !== undefined) return `${where}: blob tags have no corners`;
    }
  }
  return null;
}

/** Problem with a whole `terrainSets` list (unique ids + each set), or `null`. */
export function terrainSetsProblem(tileset: Tileset, sets: readonly TerrainSet[]): string | null {
  if (!Array.isArray(sets)) return "terrainSets must be an array";
  const ids = new Set<string>();
  for (const set of sets) {
    const problem = terrainSetProblem(tileset, set);
    if (problem) return problem;
    if (ids.has(set.id)) return `duplicate terrain set id "${set.id}"`;
    ids.add(set.id);
  }
  return null;
}

/** Terrain set `setId` of `tileset`, or `undefined`. */
export function getTerrainSet(tileset: Tileset | undefined, setId: string): TerrainSet | undefined {
  return tileset?.terrainSets?.find((s) => s.id === setId);
}

/** Tag of `tileId` in `set` (binary search; tiles are sorted), or `undefined`. */
export function terrainTagOf(set: TerrainSet, tileId: number): TerrainTileTag | undefined {
  const tiles = set.tiles;
  let lo = 0;
  let hi = tiles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = tiles[mid]!;
    if (t.tileId === tileId) return t;
    if (t.tileId < tileId) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/** `tileset` with set `set` added or replaced (same id), normalized. Not validated. */
export function withTerrainSet(tileset: Tileset, set: TerrainSet): Tileset {
  const others = (tileset.terrainSets ?? []).filter((s) => s.id !== set.id);
  const index = (tileset.terrainSets ?? []).findIndex((s) => s.id === set.id);
  const list = [...others];
  list.splice(index < 0 ? list.length : index, 0, normalizeTerrainSet(set));
  return { ...tileset, terrainSets: list };
}

/** `tileset` without terrain set `setId`. */
export function withoutTerrainSet(tileset: Tileset, setId: string): Tileset {
  return { ...tileset, terrainSets: (tileset.terrainSets ?? []).filter((s) => s.id !== setId) };
}

/**
 * Every tile id of a terrain set run through `remap` (tileset regrid);
 * tags whose tile maps nowhere are dropped. Two tags landing on one tile keep the first.
 */
export function remapTerrainSet(set: TerrainSet, remap: (tileId: number) => number | null): TerrainSet {
  const tiles: TerrainTileTag[] = [];
  const taken = new Set<number>();
  for (const tag of set.tiles) {
    const to = remap(tag.tileId);
    if (to === null || taken.has(to)) continue;
    taken.add(to);
    tiles.push({ ...tag, tileId: to });
  }
  return normalizeTerrainSet({ ...set, tiles });
}

// ------------------------------------------------------------------ template macros

/** Corner tuple `[nw, ne, se, sw]` of a corner16 mask (`NE 1, SE 2, SW 4, NW 8`). */
export function cornersOfCorner16Mask(mask: number, terrainId: number, background = 0): TerrainCorners {
  const v = (bit: number) => ((mask & bit) !== 0 ? terrainId : background);
  return [v(CORNER_NW), v(CORNER_NE), v(CORNER_SE), v(CORNER_SW)];
}

/** Tile id of block cell `slot` of `template` placed at `origin`. */
function slotTileId(tileset: Tileset, template: TerrainTemplate, origin: { col: number; row: number }, slot: number): number {
  const info = terrainTemplateInfo(template);
  return (origin.row + Math.floor(slot / info.columns)) * tileset.columns + origin.col + (slot % info.columns);
}

/**
 * Tagging macro: tags every used cell of a `template` block at `origin`
 * as terrain `terrainId` of set `setId` and returns the new (normalized)
 * tileset. Existing tags of those tiles in that set are replaced.
 *
 * - corner16 (corner sets): a corner whose template bit is set gets
 *   `terrainId`, the others `background` (default 0 = none). A tile whose
 *   four corners all come out 0 is not tagged (the brush leaves such cells
 *   empty).
 * - blob47 layouts (blob sets): `{terrainId, mask}`. `background` is
 *   ignored for tagging.
 * - When `background` is non-zero and the set has none yet, it becomes
 *   the set's `background` (what the eraser leaves).
 *
 * @throws Error on an unknown set, a kind / template family mismatch, a
 * terrain id the set does not have, or a block that does not fit.
 */
export function tagBlockWithTemplate(
  tileset: Tileset,
  setId: string,
  terrainId: number,
  template: TerrainTemplate,
  origin: { readonly col: number; readonly row: number },
  background = 0,
): Tileset {
  const set = getTerrainSet(tileset, setId);
  if (!set) throw new Error(`tagBlockWithTemplate: unknown terrain set "${setId}" in tileset "${tileset.id}"`);
  const info = terrainTemplateInfo(template);
  const wantKind: TerrainSetKind = info.family === "corner16" ? "corner" : "blob";
  if (set.kind !== wantKind) throw new Error(`tagBlockWithTemplate: template ${template} needs a ${wantKind} set, "${setId}" is ${set.kind}`);
  if (!set.terrains.some((t) => t.id === terrainId)) throw new Error(`tagBlockWithTemplate: set "${setId}" has no terrain ${terrainId}`);
  if (background !== 0 && !set.terrains.some((t) => t.id === background)) {
    throw new Error(`tagBlockWithTemplate: set "${setId}" has no terrain ${background}`);
  }
  if (origin.col < 0 || origin.row < 0 || origin.col + info.columns > tileset.columns || origin.row + info.rows > tileset.rows) {
    throw new Error(`tagBlockWithTemplate: a ${info.columns}×${info.rows} block at (${origin.col}, ${origin.row}) does not fit the tileset`);
  }
  const tags = new Map<number, TerrainTileTag>(set.tiles.map((t) => [t.tileId, t]));
  info.masks.forEach((mask, slot) => {
    if (mask === null) return;
    const tileId = slotTileId(tileset, template, origin, slot);
    if (wantKind === "corner") {
      const corners = cornersOfCorner16Mask(mask, terrainId, background);
      if (corners.every((c) => c === 0)) tags.delete(tileId);
      else tags.set(tileId, { tileId, corners });
    } else {
      tags.set(tileId, { tileId, terrainId, mask: reduceBlobMask(mask) });
    }
  });
  const next: TerrainSet = {
    ...set,
    tiles: [...tags.values()],
    ...(background !== 0 && !set.background ? { background } : {}),
  };
  return withTerrainSet(tileset, next);
}

// ------------------------------------------------------------------ flips

/**
 * Corners as they appear on screen for a tile drawn with flip flags
 * (D = transpose first, then H, then V — the Tiled order).
 */
export function flipCorners(c: TerrainCorners, flipH: boolean, flipV: boolean, flipD: boolean): TerrainCorners {
  let [nw, ne, se, sw] = c;
  if (flipD) [ne, sw] = [sw, ne];
  if (flipH) {
    [nw, ne] = [ne, nw];
    [sw, se] = [se, sw];
  }
  if (flipV) {
    [nw, sw] = [sw, nw];
    [ne, se] = [se, ne];
  }
  return [nw, ne, se, sw];
}

const swapBits = (m: number, a: number, b: number) => {
  const hasA = (m & a) !== 0;
  const hasB = (m & b) !== 0;
  m &= ~(a | b);
  return m | (hasA ? b : 0) | (hasB ? a : 0);
};

/** 8-neighbour mask as it appears on screen for a tile drawn with flip flags (D, then H, then V). */
export function flipBlobMask(mask: number, flipH: boolean, flipV: boolean, flipD: boolean): number {
  let m = mask & 255;
  if (flipD) {
    m = swapBits(m, BLOB_N, BLOB_W);
    m = swapBits(m, BLOB_S, BLOB_E);
    m = swapBits(m, BLOB_NE, BLOB_SW);
  }
  if (flipH) {
    m = swapBits(m, BLOB_E, BLOB_W);
    m = swapBits(m, BLOB_NE, BLOB_NW);
    m = swapBits(m, BLOB_SE, BLOB_SW);
  }
  if (flipV) {
    m = swapBits(m, BLOB_N, BLOB_S);
    m = swapBits(m, BLOB_NE, BLOB_SE);
    m = swapBits(m, BLOB_NW, BLOB_SW);
  }
  return m;
}

// ------------------------------------------------------------------ legacy migration

/** Id of the terrain set a legacy terrain (`Tileset.terrains`) migrates to. */
export function legacyTerrainSetId(terrainId: number): string {
  return `terrain-${terrainId}`;
}

/**
 * The terrain set equivalent to legacy terrain `terrain` (one terrain,
 * id 1, drawn over empty): its template block tagged with the macro, each
 * variant tile tagged like its slot.
 */
export function legacyTerrainToSet(tileset: Tileset, terrain: Terrain): TerrainSet {
  const info = terrainTemplateInfo(terrain.template);
  const kind: TerrainSetKind = info.family === "corner16" ? "corner" : "blob";
  const base: TerrainSet = {
    id: legacyTerrainSetId(terrain.id),
    name: terrain.name,
    kind,
    terrains: [{ id: 1, name: terrain.name, color: defaultTerrainColor(terrain.id) }],
    tiles: [],
  };
  const tagged = tagBlockWithTemplate({ ...tileset, terrainSets: [base] }, base.id, 1, terrain.template, terrain.origin);
  const set = tagged.terrainSets![0]!;
  const tags = new Map(set.tiles.map((t) => [t.tileId, t]));
  for (const v of terrain.variants ?? []) {
    const mask = info.masks[v.slot];
    if (mask === null || mask === undefined) continue;
    for (const tileId of v.tileIds) {
      if (tags.has(tileId)) continue;
      if (kind === "corner") {
        const corners = cornersOfCorner16Mask(mask, 1);
        if (corners.some((c) => c !== 0)) tags.set(tileId, { tileId, corners });
      } else {
        tags.set(tileId, { tileId, terrainId: 1, mask: reduceBlobMask(mask) });
      }
    }
  }
  return normalizeTerrainSet({ ...set, tiles: [...tags.values()] });
}

/**
 * `tileset` with every legacy terrain (`terrains`) converted to a terrain
 * set, unless a set with its id ({@link legacyTerrainSetId}) already
 * exists. The legacy `terrains` list itself is kept (deprecated API; the
 * serializer no longer writes it). Returns the same object when nothing changes.
 */
export function migrateLegacyTerrains(tileset: Tileset): Tileset {
  const legacy = tileset.terrains ?? [];
  if (legacy.length === 0) return tileset;
  const sets = [...(tileset.terrainSets ?? [])];
  let changed = false;
  for (const terrain of legacy) {
    const id = legacyTerrainSetId(terrain.id);
    if (sets.some((s) => s.id === id)) continue;
    sets.push(legacyTerrainToSet(tileset, terrain));
    changed = true;
  }
  return changed ? { ...tileset, terrainSets: sets } : tileset;
}
