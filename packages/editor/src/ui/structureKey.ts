import type { Tileset } from '@smap/core';
/** Pixel content is delivered through image subscriptions. Hash/path updates
 * alone must not rebuild every structural UI subscriber on each stroke.
 */
const keys = new WeakMap<Tileset, string>();
export function tilesetStructureKey(tilesets: readonly Tileset[]): string {
  return JSON.stringify(tilesets.map(ts => {
    let key = keys.get(ts);
    if (!key) { key = JSON.stringify(ts.edited ? { ...ts, imagePath: '', edited: { ...ts.edited, contentHash: '' } } : ts); keys.set(ts, key); }
    return key;
  }));
}
