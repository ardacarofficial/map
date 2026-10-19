import type { LevelView } from '../state/levelViewMemory';
import { clampZoom } from '../canvas/camera';

export interface CameraBookmark extends LevelView { readonly id: string; readonly name: string }
export interface BookmarkStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

function valid(value: unknown): value is CameraBookmark {
  if (!value || typeof value !== 'object') return false;
  const b = value as Partial<CameraBookmark>;
  return typeof b.id === 'string' && b.id.length > 0 && typeof b.name === 'string' && b.name.trim().length > 0 && b.name.length <= 64 && Number.isFinite(b.cx) && Number.isFinite(b.cy) && typeof b.zoom === 'number' && Number.isFinite(b.zoom) && b.zoom > 0;
}

/** localStorage is optional. A failed write keeps the session's bookmarks usable. */
export class BookmarkRepository {
  readonly #memory = new Map<string, readonly CameraBookmark[]>();
  constructor(private readonly storage: BookmarkStorage | null) {}
  #key(world: string, map: string): string { return `smap.cameraBookmarks.${JSON.stringify([world, map])}`; }
  read(world: string, map: string): readonly CameraBookmark[] {
    const key = this.#key(world, map), cached = this.#memory.get(key);
    if (cached) return cached;
    try {
      const value: unknown = JSON.parse(this.storage?.getItem(key) ?? '[]');
      if (Array.isArray(value)) {
        const seen = new Set<string>();
        const result = value.filter(valid).filter(b => { if (seen.has(b.id)) return false; seen.add(b.id); return true; });
        this.#memory.set(key, result);
        return result;
      }
    } catch { /* Corrupt or blocked storage starts with an empty list. */ }
    return [];
  }
  write(world: string, map: string, bookmarks: readonly CameraBookmark[]): boolean {
    const key = this.#key(world, map);
    this.#memory.set(key, bookmarks);
    try { if (!this.storage) return false; this.storage.setItem(key, JSON.stringify(bookmarks)); return true; } catch { return false; }
  }
}

/** Clamp to valid cell centres after a resize; view data never changes the map. */
export function clampBookmarkView(view: LevelView, map: { width: number; height: number; tileWidth: number; tileHeight: number }): LevelView {
  return {
    cx: Math.max(map.tileWidth / 2, Math.min((map.width - 0.5) * map.tileWidth, view.cx)),
    cy: Math.max(map.tileHeight / 2, Math.min((map.height - 0.5) * map.tileHeight, view.cy)),
    zoom: clampZoom(view.zoom),
  };
}
