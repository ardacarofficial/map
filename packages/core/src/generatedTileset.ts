import { bandWidth } from "./smartStamp/bands";
/** Pure authoring metadata. PNG IO and atomic staging belong to the editor; source PNGs are always read-only. */
import type { NineSliceInnerCorner } from "./nineSlice";
import { NINE_SLICE_LAYOUT_VERSION, nineSliceBlits, nineSliceLayout } from "./nineSlice";
import { stampIdProblem, type Stamp } from "./stamp";
import { isValidTileId, normalizeTileset, relativePathProblem, tilesetProblem, type Tileset } from "./tileset";

/** Inputs for preparing a new bake or regenerating an existing generated id. All project tilesets must be supplied to check path/id ownership. */
export interface PrepareNineSliceTilesetOptions {
  readonly id: string;
  /** A distinct project-relative PNG under tilesets/. Never a user-owned image path, including Windows case aliases. */
  readonly imagePath: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly tilesets: readonly Tileset[];
  /** Actual current PNG byte hashes, supplied by the editor. Unknown/missing hashes reject the bake. */
  readonly imageHashes: ReadonlyMap<string, string>;
  /** Layout 1 defaults to 8 columns; layout 2 uses compact packing. Regeneration must retain the existing columns. */
  readonly columns?: number;
  /** Omitted during regeneration retains the saved choice; null explicitly restores square inner joins. */
  readonly innerCorner?: NineSliceInnerCorner | null;
  /** Omitted during regeneration retains the saved join; null explicitly restores legacy square inner joins. */
  readonly innerJoin?: "miter" | null;
}

/**
 * Prepares a separate `<stamp name> (yol)` generated tileset, or refreshes the existing generated id in place.
 * It never modifies input metadata or pixels. Sources include optional inner artwork; hashes are sorted and persisted.
 * Existing identity, PNG path, source dimensions, pixel grid and allocated capacity cannot shrink or move. A differently
 * sized source recipe needs a fresh id; future extra slots may only append, growing rows while retaining columns.
 *
 * Stage the PNG only at result.imagePath. After successful regeneration use setTilesetMeta.generated with undoable: false to acknowledge
 * its source hashes (and name if renamed); the store records undo/redo without changing any palette entries/map cells.
 * A source PNG change therefore replaces the generated PNG at the SAME id/path/slots, never the user's PNG.
 * @throws Error on source/reference/hash errors, a user-owned target, path collision or incompatible regeneration.
 */
export function prepareNineSliceTileset(stamp: Stamp, layerId: string, options: PrepareNineSliceTilesetOptions): Tileset {
  const idProblem = stampIdProblem(stamp.id) ?? stampIdProblem(options.id);
  if (idProblem) throw new Error(idProblem);
  if (relativePathProblem(options.imagePath) || !/^tilesets\/.+\.png$/i.test(options.imagePath)) throw new Error("generated image must be a separate PNG under tilesets/");
  const border = bandWidth(stamp), layoutVersion = border > 1 ? 2 : NINE_SLICE_LAYOUT_VERSION;
  const existing = options.tilesets.find(t => t.id === options.id);
  if (existing && !existing.generated) throw new Error("cannot replace a user tileset with a generated bake");
  if (options.tilesets.some(t => t.id !== existing?.id && t.imagePath.toLowerCase() === options.imagePath.toLowerCase())) throw new Error("generated output cannot overwrite another tileset PNG");
  if (existing) {
    const g = existing.generated!;
    if (g.kind !== "nineSlice" || g.layoutVersion !== layoutVersion || (g.border ?? 1) !== border || g.stampId !== stamp.id || g.layerId !== layerId) throw new Error("generated origin/layout does not match this stamp layer");
    if (g.sourceWidth !== stamp.width || g.sourceHeight !== stamp.height) throw new Error("source dimensions changed; allocate a new generated id instead of moving slots");
    if (existing.imagePath !== options.imagePath || existing.tileWidth !== options.tileWidth || existing.tileHeight !== options.tileHeight) throw new Error("regeneration must retain the generated PNG path and pixel dimensions");
    if (options.columns !== undefined && options.columns !== existing.columns) throw new Error("regeneration must retain columns so tile ids never move");
  }
  const innerCorner = options.innerCorner === undefined ? existing?.generated?.innerCorner : options.innerCorner ?? undefined;
  const innerJoin = options.innerJoin === undefined ? existing?.generated?.innerJoin : options.innerJoin ?? undefined;
  const layout = nineSliceLayout(stamp), blits = nineSliceBlits(stamp, layerId, options.tileWidth, options.tileHeight, innerCorner, innerJoin);
  const sourceIds = new Set<string>();
  for (const b of blits) {
    const source = options.tilesets.find(t => t.id === b.tile.tilesetId);
    if (!source || !isValidTileId(source, b.tile.tileId) || source.tileWidth !== options.tileWidth || source.tileHeight !== options.tileHeight) throw new Error("missing or incompatible source tile reference");
    if (source.id === options.id || source.imagePath.toLowerCase() === options.imagePath.toLowerCase()) throw new Error("generated output cannot overwrite its source PNG");
    sourceIds.add(source.id);
  }
  const columns = existing?.columns ?? options.columns ?? (border > 1 ? Math.ceil(Math.sqrt(layout.slots)) : 8);
  if (!Number.isInteger(columns) || columns < 1) throw new Error("generated columns must be a positive integer");
  const sources = [...sourceIds].sort().map(tilesetId => {
    const imageHash = options.imageHashes.get(tilesetId);
    if (typeof imageHash !== "string" || !imageHash) throw new Error(`missing PNG image hash for ${tilesetId}`);
    return { tilesetId, imageHash };
  });
  const next: Tileset = {
    ...(existing ?? {}), id: options.id, name: `${stamp.name} (yol)`, imagePath: options.imagePath,
    tileWidth: options.tileWidth, tileHeight: options.tileHeight, columns,
    rows: Math.max(existing?.rows ?? 0, Math.ceil(layout.slots / columns)), margin: existing?.margin ?? 0, spacing: existing?.spacing ?? 0,
    generated: { kind: "nineSlice", stampId: stamp.id, layerId, sourceWidth: stamp.width, sourceHeight: stamp.height, layoutVersion, ...(border > 1 ? { border } : {}), ...(innerCorner ? { innerCorner } : {}), ...(innerJoin ? { innerJoin } : {}), sources },
  };
  const problem = tilesetProblem(next);
  if (problem) throw new Error(problem);
  return normalizeTileset(next);
}


/** Current PNG hashes and complete project asset registry for regeneration; identity and packing come from the existing generated asset. */
export type RegenerateNineSliceTilesetOptions = Pick<PrepareNineSliceTilesetOptions, "tilesets" | "imageHashes" | "innerCorner" | "innerJoin">;

/**
 * Explicit source-PNG regeneration. The caller cannot request a new id/path/grid: these are taken from the
 * persisted generated asset. Returns fresh provenance for the same tile ids, including after save/reopen.
 * The optional authored inner-corner selection is restored from persisted metadata when omitted.
 * Missing source hashes/assets or a source dimension change reject before any PNG may be published.
 */
export function regenerateNineSliceTileset(stamp: Stamp, layerId: string, tilesetId: string, options: RegenerateNineSliceTilesetOptions): Tileset {
  const existing = options.tilesets.find(t => t.id === tilesetId);
  if (!existing?.generated) throw new Error("regeneration requires an existing generated tileset");
  return prepareNineSliceTileset(stamp, layerId, { ...options, id: existing.id, imagePath: existing.imagePath, tileWidth: existing.tileWidth, tileHeight: existing.tileHeight, columns: existing.columns });
}
