import type { Tileset } from '@smap/core';
/** Pixel content is delivered through image subscriptions. Hash/path updates
 * alone must not rebuild every structural UI subscriber on each stroke.
 */
const keys = new WeakMap<Tileset, string>();
// Provenance is immutable and append-only. Compare its identity without walking
// every allocated tile for every structural subscriber on each pixel commit.
const provenanceKeys = new WeakMap<NonNullable<Tileset['edited']>['origins'], number>();
let nextProvenanceKey = 0;
function provenanceKey(origins: NonNullable<Tileset['edited']>['origins']): number {
  let key = provenanceKeys.get(origins);
  if (key === undefined) { key = ++nextProvenanceKey; provenanceKeys.set(origins, key); }
  return key;
}
export function tilesetStructureKey(tilesets: readonly Tileset[]): string {
  return JSON.stringify(tilesets.map(ts => {
    let key = keys.get(ts);
    if (!key) {
      // Destructuring/spreading a revision would invoke its lazy path/hash getters.
      key = JSON.stringify(ts.edited ? { id: ts.id, name: ts.name, group: ts.group, tileWidth: ts.tileWidth, tileHeight: ts.tileHeight, columns: ts.columns, rows: ts.rows, margin: ts.margin, spacing: ts.spacing, edited: { kind: ts.edited.kind, layoutVersion: ts.edited.layoutVersion, nextTileId: ts.edited.nextTileId, origins: provenanceKey(ts.edited.origins) } } : ts);
      keys.set(ts, key);
    }
    return key;
  }));
}
