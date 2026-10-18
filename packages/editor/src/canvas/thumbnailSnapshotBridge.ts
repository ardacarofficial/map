/** Platform-neutral handoff from the live overview to optional recent pictures.
 * Providers copy only the small final picture, and only when asked at idle.
 * Object identity distinguishes projects even when their level IDs are equal.
 */
import type { Pixels } from "./thumbnailRaster";

export const RECENT_THUMB_PX = 192;

export interface ThumbnailTag {
  readonly project: object;
  readonly level: string;
  readonly revision: number;
}

export interface ThumbnailState extends ThumbnailTag {
  readonly version: number;
  readonly pending: boolean;
}

export interface ThumbnailSnapshot extends ThumbnailTag {
  /** Distinguishes canvas lifetimes whose pixel versions both start at zero. */
  readonly generation: number;
  readonly version: number;
  /** Owned by this snapshot; a provider must never mutate these pixels. */
  readonly pixels: Pixels;
}

export interface ThumbnailProvider {
  state(): ThumbnailState;
  snapshot(): Pixels | undefined;
}

export class ThumbnailSnapshotBridge {
  #provider: ThumbnailProvider | null = null;
  #generation = 0;
  readonly #listeners = new Set<() => void>();

  register(provider: ThumbnailProvider): () => void {
    this.#provider = provider;
    this.#generation++;
    this.changed();
    return () => {
      if (this.#provider !== provider) return;
      this.#provider = null;
      this.#generation++;
      this.changed();
    };
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  changed(): void {
    for (const listener of this.#listeners) listener();
  }

  ready(tag: ThumbnailTag): boolean {
    const state = this.#provider?.state();
    return !!state && !state.pending && state.project === tag.project && state.level === tag.level && state.revision >= tag.revision;
  }

  snapshot(tag: ThumbnailTag): ThumbnailSnapshot | undefined {
    if (!this.ready(tag)) return undefined;
    const provider = this.#provider!;
    const state = provider.state();
    const pixels = provider.snapshot();
    return pixels ? { generation: this.#generation, project: state.project, level: state.level, revision: state.revision, version: state.version, pixels } : undefined;
  }

  matches(snapshot: ThumbnailSnapshot): boolean {
    const state = this.#provider?.state();
    return !!state && snapshot.generation === this.#generation && !state.pending && state.project === snapshot.project && state.level === snapshot.level &&
      state.revision === snapshot.revision && state.version === snapshot.version;
  }
}

export const thumbnailSnapshots = new ThumbnailSnapshotBridge();
