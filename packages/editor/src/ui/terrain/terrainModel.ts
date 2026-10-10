/**
 * Pure helpers of the terrain UI (terrain as a brush on tile layers; the
 * data are tags on tileset tiles, core `terrainSet.ts`). No React, no
 * stores — tested in `terrainModel.test.ts`.
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
  defaultTerrainColor,
  getTerrainSet,
  MAX_SET_TERRAIN_ID,
  reduceBlobMask,
  tagBlockWithTemplate,
  terrainTagOf,
  terrainTemplateInfo,
  type MapDocument,
  type TerrainCorners,
  type TerrainSet,
  type TerrainSetKind,
  type TerrainSetTerrain,
  type TerrainTemplate,
  type TerrainTileTag,
  type Tileset,
} from "@smap/core";

/** A terrain of a set of a tileset (what the terrain brush paints). */
export interface TerrainRef {
  readonly tilesetId: string;
  readonly setId: string;
  readonly terrainId: number;
}

/** A terrain set with its tileset. */
export interface TerrainSetEntry {
  readonly tileset: Tileset;
  readonly set: TerrainSet;
}

/** Every terrain set of the document, tileset order then set order. */
export function terrainSetEntries(doc: MapDocument | undefined): TerrainSetEntry[] {
  if (!doc) return [];
  return doc.tilesets.flatMap((tileset) => (tileset.terrainSets ?? []).map((set) => ({ tileset, set })));
}

/** The tileset, set and terrain `ref` names, or null when any of them is gone. */
export function resolveTerrain(
  doc: MapDocument | undefined,
  ref: TerrainRef | null | undefined,
): { tileset: Tileset; set: TerrainSet; terrain: TerrainSetTerrain } | null {
  if (!doc || !ref) return null;
  const tileset = doc.getTileset(ref.tilesetId);
  const set = getTerrainSet(tileset, ref.setId);
  const terrain = set?.terrains.find((t) => t.id === ref.terrainId);
  return tileset && set && terrain ? { tileset, set, terrain } : null;
}

/** True when `a` and `b` name the same terrain. */
export function sameTerrain(a: TerrainRef | null | undefined, b: TerrainRef | null | undefined): boolean {
  return !!a && !!b && a.tilesetId === b.tilesetId && a.setId === b.setId && a.terrainId === b.terrainId;
}

/** Set kind a template tags: corner16 → corner sets, the blob layouts → blob sets. */
export function kindOfTemplate(template: TerrainTemplate): TerrainSetKind {
  return terrainTemplateInfo(template).family === "corner16" ? "corner" : "blob";
}

/** "terrain-1", "terrain-2"... — the smallest id no set of `tileset` uses. */
export function uniqueSetId(tileset: Tileset): string {
  const taken = new Set((tileset.terrainSets ?? []).map((s) => s.id));
  for (let n = 1; ; n++) {
    const id = `terrain-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** Smallest unused terrain id ≥ 1 of `set` (null when the set is full). */
export function nextTerrainId(set: TerrainSet | undefined): number | null {
  const taken = new Set((set?.terrains ?? []).map((t) => t.id));
  for (let id = 1; id <= MAX_SET_TERRAIN_ID; id++) if (!taken.has(id)) return id;
  return null;
}

/** A colour for the next terrain of `set` that its terrains do not use yet (cycles when all are used). */
export function nextTerrainColor(set: TerrainSet | undefined): string {
  const used = new Set((set?.terrains ?? []).map((t) => t.color.toLowerCase()));
  for (let id = 1; id <= 8; id++) {
    const color = defaultTerrainColor(id);
    if (!used.has(color)) return color;
  }
  return defaultTerrainColor((set?.terrains.length ?? 0) + 1);
}

/** `base`, or `base 2`, `base 3`... — the first that no name in `taken` uses. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!names.has(name)) return name;
  }
}

// ------------------------------------------------------------------ 3×3 preview

/** Blob bit of each neighbour offset (dx, dy) of a 3×3 patch. */
const BLOB_BITS: readonly (readonly [number, number, number])[] = [
  [0, -1, BLOB_N],
  [1, -1, BLOB_NE],
  [1, 0, BLOB_E],
  [1, 1, BLOB_SE],
  [0, 1, BLOB_S],
  [-1, 1, BLOB_SW],
  [-1, 0, BLOB_W],
  [-1, -1, BLOB_NW],
];

/** Tile with exactly these (unflipped) corners in a corner set, or null. */
export function tileWithCorners(set: TerrainSet, corners: TerrainCorners): number | null {
  const tag = set.tiles.find((t) => t.corners && t.corners.every((c, i) => c === corners[i]));
  return tag ? tag.tileId : null;
}

/** Tile of terrain `terrainId` showing (reduced) blob `mask` in a blob set, or null. */
export function tileWithMask(set: TerrainSet, terrainId: number, mask: number): number | null {
  const want = reduceBlobMask(mask);
  const tag = set.tiles.find((t) => t.terrainId === terrainId && t.mask === want);
  return tag ? tag.tileId : null;
}

/**
 * What a 3×3 patch of `terrainId` on the set's background looks like:
 * nine tile ids (row-major), null where the set has no tile for that spot.
 * This is the "auto-connect" preview of the ARAZİ card: edges and corners
 * around a full centre.
 */
export function previewTiles(set: TerrainSet, terrainId: number): (number | null)[] {
  const out: (number | null)[] = [];
  if (set.kind === "corner") {
    const bg = set.background ?? 0;
    // 4×4 vertices: the inner 2×2 carry the terrain.
    const v = (x: number, y: number) => (x >= 1 && x <= 2 && y >= 1 && y <= 2 ? terrainId : bg);
    for (let cy = 0; cy < 3; cy++) {
      for (let cx = 0; cx < 3; cx++) out.push(tileWithCorners(set, [v(cx, cy), v(cx + 1, cy), v(cx + 1, cy + 1), v(cx, cy + 1)]));
    }
    return out;
  }
  for (let cy = 0; cy < 3; cy++) {
    for (let cx = 0; cx < 3; cx++) {
      let mask = 0;
      for (const [dx, dy, bit] of BLOB_BITS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < 3 && ny >= 0 && ny < 3) mask |= bit;
      }
      out.push(tileWithMask(set, terrainId, mask));
    }
  }
  return out;
}

/** The terrain's representative tile (fully surrounded), or the first tile tagged with it; null when it has none. */
export function terrainSwatch(set: TerrainSet, terrainId: number): number | null {
  const full = set.kind === "corner" ? tileWithCorners(set, [terrainId, terrainId, terrainId, terrainId]) : tileWithMask(set, terrainId, 255);
  if (full !== null) return full;
  const any = set.tiles.find((t) => (set.kind === "corner" ? t.corners?.includes(terrainId) : t.terrainId === terrainId));
  return any ? any.tileId : null;
}

/** Number of tiles tagged with terrain `terrainId` (any corner, or blob membership). */
export function taggedCount(set: TerrainSet, terrainId: number): number {
  return set.tiles.filter((t) => (set.kind === "corner" ? t.corners?.includes(terrainId) : t.terrainId === terrainId)).length;
}

// ------------------------------------------------------------------ picking

/**
 * Terrain shown by a tile tag: blob → its terrain; corner → the terrain on
 * most corners (ties: the first corner in nw, ne, se, sw order); 0 when no
 * corner carries one.
 */
export function terrainOfTag(set: TerrainSet, tag: TerrainTileTag): number {
  if (set.kind === "blob") return tag.terrainId ?? 0;
  const counts = new Map<number, number>();
  let best = 0;
  let bestCount = 0;
  for (const c of tag.corners ?? []) {
    if (c === 0) continue;
    const n = (counts.get(c) ?? 0) + 1;
    counts.set(c, n);
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

/**
 * The terrain a right click on tile `tileId` of `tileset` picks: the first
 * set (preferring `prefer`'s set) that tags it. Null when no set tags it.
 */
export function terrainOfTile(tileset: Tileset, tileId: number, prefer?: TerrainRef | null): TerrainRef | null {
  const sets = [...(tileset.terrainSets ?? [])];
  if (prefer && prefer.tilesetId === tileset.id) sets.sort((a, b) => Number(b.id === prefer.setId) - Number(a.id === prefer.setId));
  for (const set of sets) {
    const tag = terrainTagOf(set, tileId);
    if (!tag) continue;
    const terrainId = terrainOfTag(set, tag);
    if (terrainId !== 0) return { tilesetId: tileset.id, setId: set.id, terrainId };
  }
  return null;
}

// ------------------------------------------------------------------ "Düzelt": hand tagging

/** Which part of a tile a click hit: corner index 0..3 (nw, ne, se, sw), or a blob zone. */
export type TagZone =
  | { readonly kind: "corner"; readonly corner: 0 | 1 | 2 | 3 }
  /** Blob: a neighbour bit (`BLOB_*`), or 0 = the centre (membership). */
  | { readonly kind: "blob"; readonly bit: number };

/**
 * Zone of a click at (`fx`, `fy`) inside a tile (fractions 0..1): corner
 * sets use the quadrant; blob sets a 3×3 grid (centre = membership, the
 * eight others = neighbour bits).
 */
export function zoneAt(kind: TerrainSetKind, fx: number, fy: number): TagZone {
  if (kind === "corner") {
    const east = fx >= 0.5;
    const south = fy >= 0.5;
    return { kind: "corner", corner: south ? (east ? 2 : 3) : east ? 1 : 0 };
  }
  const col = Math.min(2, Math.max(0, Math.floor(fx * 3)));
  const row = Math.min(2, Math.max(0, Math.floor(fy * 3)));
  const bits = [BLOB_NW, BLOB_N, BLOB_NE, BLOB_W, 0, BLOB_E, BLOB_SW, BLOB_S, BLOB_SE];
  return { kind: "blob", bit: bits[row * 3 + col]! };
}

/**
 * The set after a "Düzelt" click on `zone` of tile `tileId` with terrain
 * `terrainId`. Tagging only — no rules:
 * - corner: the corner flips between `terrainId` and the set's background
 *   (a tile whose four corners become 0 loses its tag);
 * - blob, centre: membership on (mask 0) / off (tag removed);
 * - blob, neighbour zone: the bit flips (the tile joins `terrainId` if it
 *   was not tagged or belonged to another terrain).
 */
export function toggleTag(set: TerrainSet, tileId: number, zone: TagZone, terrainId: number): TerrainSet {
  const tiles = set.tiles.filter((t) => t.tileId !== tileId);
  const tag = terrainTagOf(set, tileId);
  if (zone.kind === "corner") {
    if (set.kind !== "corner") return set;
    const bg = set.background ?? 0;
    const corners = [...(tag?.corners ?? [bg, bg, bg, bg])] as [number, number, number, number];
    corners[zone.corner] = corners[zone.corner] === terrainId ? bg : terrainId;
    if (corners.some((c) => c !== 0)) tiles.push({ tileId, corners });
    return { ...set, tiles };
  }
  if (set.kind !== "blob") return set;
  const member = tag !== undefined && tag.terrainId === terrainId;
  if (zone.bit === 0) {
    if (!member) tiles.push({ tileId, terrainId, mask: 0 });
    return { ...set, tiles };
  }
  const mask = member ? (tag.mask ?? 0) ^ zone.bit : zone.bit;
  tiles.push({ tileId, terrainId, mask: reduceBlobMask(mask) });
  return { ...set, tiles };
}

/** A set without terrain `terrainId`: its tags go (corner tags only lose that terrain's corners), the background resets if it was it. */
export function withoutTerrain(set: TerrainSet, terrainId: number): TerrainSet {
  const tiles: TerrainTileTag[] = [];
  for (const tag of set.tiles) {
    if (set.kind === "blob") {
      if (tag.terrainId !== terrainId) tiles.push(tag);
      continue;
    }
    const corners = (tag.corners ?? [0, 0, 0, 0]).map((c) => (c === terrainId ? 0 : c)) as unknown as TerrainCorners;
    if (corners.some((c) => c !== 0)) tiles.push({ tileId: tag.tileId, corners });
  }
  const background = set.background === terrainId ? 0 : (set.background ?? 0);
  const { background: _drop, ...rest } = set;
  return { ...rest, terrains: set.terrains.filter((t) => t.id !== terrainId), tiles, ...(background ? { background } : {}) };
}

/** Tile ids of a template block at `origin` (used cells only, row-major), for outlines. */
export function blockTileIds(tileset: Tileset, template: TerrainTemplate, origin: { col: number; row: number }): number[] {
  const info = terrainTemplateInfo(template);
  const out: number[] = [];
  info.masks.forEach((mask, slot) => {
    if (mask === null) return;
    out.push((origin.row + Math.floor(slot / info.columns)) * tileset.columns + origin.col + (slot % info.columns));
  });
  return out;
}

/** Short template label for the candidate list ("Blob 47 · Godot 3×3 minimal (12×4)" → "Godot 3×3 minimal (12×4)"). */
export function templateLabel(template: TerrainTemplate): string {
  return terrainTemplateInfo(template).name.replace(/^Blob 47 · |^Corner 16 · /, "");
}

// ------------------------------------------------------------------ define preview

/** What a not-yet-defined terrain would add (see `draftResult`). */
export interface DraftInput {
  readonly template: TerrainTemplate;
  readonly origin: { readonly col: number; readonly row: number };
  /** Existing set (same kind) or null for a new one. */
  readonly setId: string | null;
  readonly name: string;
  readonly color: string;
  readonly background: number;
}

/**
 * The set as it would be after "Tanımla" (tags applied with core
 * `tagBlockWithTemplate`) and the new terrain's id — for the ARAZİ card's
 * 3×3 preview and for `defineTerrain`. Null when the block does not fit or
 * the set kind does not match the template.
 */
export function draftResult(
  tileset: Tileset,
  input: DraftInput,
  newSetName = input.name,
): { set: TerrainSet; terrainId: number } | null {
  const kind = kindOfTemplate(input.template);
  const existing = input.setId ? getTerrainSet(tileset, input.setId) : undefined;
  if (input.setId && (!existing || existing.kind !== kind)) return null;
  const terrainId = nextTerrainId(existing);
  if (terrainId === null) return null;
  const terrain = { id: terrainId, name: input.name, color: input.color.toLowerCase() };
  const base: TerrainSet = existing
    ? { ...existing, terrains: [...existing.terrains, terrain] }
    : { id: uniqueSetId(tileset), name: newSetName, kind, terrains: [terrain], tiles: [] };
  const background = input.background !== 0 && base.terrains.some((x) => x.id === input.background) ? input.background : 0;
  try {
    const tagged = tagBlockWithTemplate(
      { ...tileset, terrainSets: [...(tileset.terrainSets ?? []).filter((s) => s.id !== base.id), base] },
      base.id,
      terrainId,
      input.template,
      input.origin,
      background,
    );
    const set = getTerrainSet(tagged, base.id);
    return set ? { set, terrainId } : null;
  } catch {
    return null;
  }
}
