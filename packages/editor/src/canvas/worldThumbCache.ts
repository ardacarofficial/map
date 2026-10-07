/**
 * Bookkeeping of the world view's per-level thumbnails (v1.2): which level
 * needs a (re)load, stale-while-revalidate (the old picture stays on screen
 * until the new one is ready), and out-of-order async completions. Generic
 * over the cached value so it is unit tested without Pixi or a DOM.
 *
 * - {@link begin} / {@link complete} / {@link fail} wrap one async load.
 *   A completion whose load was superseded (newer `begin`, entry dropped)
 *   is disposed and ignored.
 * - {@link invalidate} marks entries stale. A load in flight keeps running;
 *   its result is shown but the entry stays stale, so it is loaded again.
 * - Failed loads are not retried until the level is invalidated.
 */

export type ThumbStatus = "loading" | "ready" | "failed" | "idle";

interface Entry<T> {
  value: T | null;
  status: ThumbStatus;
  /** Bumped by every `begin`; identifies the load in flight. */
  token: number;
  /** Bumped by every `invalidate`. */
  generation: number;
  /** `generation` when the current load started. */
  loadGeneration: number;
  /** `generation` the value was loaded at. */
  valueGeneration: number;
}

export class ThumbCache<T> {
  readonly #entries = new Map<string, Entry<T>>();
  readonly #dispose: (value: T) => void;
  #nextToken = 1;

  constructor(dispose: (value: T) => void) {
    this.#dispose = dispose;
  }

  /** The cached value (possibly stale), or null. */
  get(id: string): T | null {
    return this.#entries.get(id)?.value ?? null;
  }

  status(id: string): ThumbStatus {
    return this.#entries.get(id)?.status ?? "idle";
  }

  /** True when the cached value is older than the last invalidation (or missing). */
  isStale(id: string): boolean {
    const e = this.#entries.get(id);
    return !e || e.value === null || e.valueGeneration !== e.generation;
  }

  /** True while any load is in flight. */
  get loading(): boolean {
    for (const e of this.#entries.values()) if (e.status === "loading") return true;
    return false;
  }

  /**
   * Ids (in the given order) that should start a load now: never loaded, or
   * stale — not while a load is running, and not after a failure until the
   * next invalidation. `skip` (the live active level) is left out.
   */
  needsLoad(ids: Iterable<string>, skip?: string | null): string[] {
    const out: string[] = [];
    for (const id of ids) {
      if (id === skip) continue;
      const e = this.#entries.get(id);
      if (!e) {
        out.push(id);
        continue;
      }
      if (e.status === "loading") continue;
      const stale = e.value === null || e.valueGeneration !== e.generation;
      if (e.status === "failed" && e.loadGeneration === e.generation) continue;
      if (stale) out.push(id);
    }
    return out;
  }

  /** Starts a load of `id`; returns its token for {@link complete} / {@link fail}. */
  begin(id: string): number {
    const token = this.#nextToken++;
    let e = this.#entries.get(id);
    if (!e) {
      e = { value: null, status: "loading", token, generation: 0, loadGeneration: 0, valueGeneration: -1 };
      this.#entries.set(id, e);
    } else {
      e.status = "loading";
      e.token = token;
      e.loadGeneration = e.generation;
    }
    return token;
  }

  /** A load finished. Returns false (and disposes `value`) when it was superseded. */
  complete(id: string, token: number, value: T): boolean {
    const e = this.#entries.get(id);
    if (!e || e.token !== token || e.status !== "loading") {
      this.#dispose(value);
      return false;
    }
    if (e.value !== null && e.value !== value) this.#dispose(e.value);
    e.value = value;
    e.status = "ready";
    e.valueGeneration = e.loadGeneration;
    return true;
  }

  /** A load failed. The old value (if any) stays. Returns false when superseded. */
  fail(id: string, token: number): boolean {
    const e = this.#entries.get(id);
    if (!e || e.token !== token || e.status !== "loading") return false;
    e.status = "failed";
    return true;
  }

  /** Stores a ready value directly (e.g. a snapshot of the live picture), fresh. */
  set(id: string, value: T): void {
    const e = this.#entries.get(id);
    if (e) {
      if (e.value !== null && e.value !== value) this.#dispose(e.value);
      e.value = value;
      e.status = "ready";
      e.token = this.#nextToken++; // a load in flight is now superseded
      e.valueGeneration = e.generation;
      e.loadGeneration = e.generation;
    } else {
      this.#entries.set(id, { value, status: "ready", token: this.#nextToken++, generation: 0, loadGeneration: 0, valueGeneration: 0 });
    }
  }

  /** Marks the given levels (or all) stale; they are reloaded by the next {@link needsLoad}. */
  invalidate(ids: Iterable<string> | "all"): void {
    if (ids === "all") {
      for (const e of this.#entries.values()) e.generation++;
      return;
    }
    for (const id of ids) {
      const e = this.#entries.get(id);
      if (e) e.generation++;
    }
  }

  /** Drops (and disposes) entries whose id is not in `ids` (removed levels). */
  retain(ids: ReadonlySet<string>): void {
    for (const [id, e] of this.#entries) {
      if (ids.has(id)) continue;
      if (e.value !== null) this.#dispose(e.value);
      this.#entries.delete(id);
    }
  }

  /** Drops one entry. */
  delete(id: string): void {
    const e = this.#entries.get(id);
    if (!e) return;
    if (e.value !== null) this.#dispose(e.value);
    this.#entries.delete(id);
  }

  clear(): void {
    this.retain(new Set());
  }

  /** Every cached value (for e.g. "a tileset image changed"). */
  values(): T[] {
    const out: T[] = [];
    for (const e of this.#entries.values()) if (e.value !== null) out.push(e.value);
    return out;
  }
}
