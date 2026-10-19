import type { Tileset } from '../tileset';
export interface EditedTileOrigin {
  readonly tileId: number;
  readonly sourceTilesetId: string;
  readonly sourceTileId: number;
  readonly sourcePixelHash: string;
}
export interface EditedTilesetMetadata {
  readonly kind: 'pixel';
  readonly layoutVersion: 1;
  readonly nextTileId: number;
  readonly contentHash: string;
  readonly origins: readonly EditedTileOrigin[];
}
export const EDITED_ATLAS_COLUMNS = 16;
export const MAX_EDITED_TILES = 4096;
export function editedTilesetMetadataProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'edited metadata must be an object';
  const m = value as Partial<EditedTilesetMetadata>;
  if (m.kind !== 'pixel' || m.layoutVersion !== 1) return 'unsupported edited kind or layout version';
  if (!Number.isSafeInteger(m.nextTileId) || m.nextTileId! < 1 || m.nextTileId! > MAX_EDITED_TILES) return 'invalid edited nextTileId';
  if (typeof m.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(m.contentHash)) return 'edited contentHash must be a SHA-256 hex digest';
  if (!Array.isArray(m.origins)) return 'edited origins must be an array';
  const seen = new Set<number>();
  for (const o of m.origins) {
    if (!o || !Number.isSafeInteger(o.tileId) || o.tileId < 0 || o.tileId >= m.nextTileId! || seen.has(o.tileId) || typeof o.sourceTilesetId !== 'string' || !o.sourceTilesetId || !Number.isSafeInteger(o.sourceTileId) || o.sourceTileId < 0 || typeof o.sourcePixelHash !== 'string' || !o.sourcePixelHash) return 'invalid or duplicate edited origin';
    seen.add(o.tileId);
  }
  return null;
}
export function normalizeEditedTilesetMetadata(m: EditedTilesetMetadata): EditedTilesetMetadata {
  const problem = editedTilesetMetadataProblem(m);
  if (problem) throw new Error(problem);
  return Object.freeze({ kind: 'pixel', layoutVersion: 1, nextTileId: m.nextTileId, contentHash: m.contentHash, origins: Object.freeze([...m.origins].sort((a,b) => a.tileId-b.tileId).map(o => Object.freeze({ tileId: o.tileId, sourceTilesetId: o.sourceTilesetId, sourceTileId: o.sourceTileId, sourcePixelHash: o.sourcePixelHash }))) });
}
/** Road-generated and independently edited assets share permissions/grouping, never regeneration recipes. */
export function isGeneratedAsset(tileset: Tileset): boolean { return !!(tileset.generated || tileset.edited); }
export function editedImagePath(assetId: string, contentHash: string): string { return `tilesets/${assetId}-${contentHash}.png`; }
