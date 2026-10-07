/**
 * Autosave timing. After a change, waits until the user has been idle for
 * `idleMs`, but never longer than `maxWaitMs` after the first unsaved change
 * (so continuous drawing still gets saved). Changes made while a save runs
 * schedule another save afterwards. Pure timing: what "save" means is the
 * caller's business.
 */
export interface AutosaveOptions {
  /** Quiet time before saving. Default 2 s. */
  idleMs?: number;
  /** Longest delay after the first unsaved change. Default 30 s. */
  maxWaitMs?: number;
  save(): Promise<void>;
  /** Called when `save` rejects (the scheduler keeps working). */
  onError?(error: unknown): void;
  now?(): number;
}

export const AUTOSAVE_IDLE_MS = 2000;
export const AUTOSAVE_MAX_WAIT_MS = 30_000;

export class AutosaveScheduler {
  readonly #idleMs: number;
  readonly #maxWaitMs: number;
  readonly #save: () => Promise<void>;
  readonly #onError: (error: unknown) => void;
  readonly #now: () => number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #firstChangeAt: number | null = null;
  #saving: Promise<void> | null = null;
  #changedWhileSaving = false;
  #disposed = false;

  constructor(options: AutosaveOptions) {
    this.#idleMs = options.idleMs ?? AUTOSAVE_IDLE_MS;
    this.#maxWaitMs = options.maxWaitMs ?? AUTOSAVE_MAX_WAIT_MS;
    this.#save = options.save;
    this.#onError = options.onError ?? (() => undefined);
    this.#now = options.now ?? Date.now;
  }

  /** True while a save is waiting to run or running. */
  get pending(): boolean {
    return this.#timer !== null || this.#saving !== null;
  }

  /** Reports a change; (re)schedules the save. */
  notifyChange(): void {
    if (this.#disposed) return;
    if (this.#saving) {
      this.#changedWhileSaving = true;
      return;
    }
    const now = this.#now();
    this.#firstChangeAt ??= now;
    const deadline = this.#firstChangeAt + this.#maxWaitMs;
    const delay = Math.max(0, Math.min(this.#idleMs, deadline - now));
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#run(), delay);
  }

  /** Saves now if a save is scheduled; resolves when no save is running. */
  async flush(): Promise<void> {
    if (this.#timer !== null) await this.#run();
    else if (this.#saving) await this.#saving;
  }

  /** Drops a scheduled save (a running one finishes). */
  cancel(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#firstChangeAt = null;
    this.#changedWhileSaving = false;
  }

  dispose(): void {
    this.cancel();
    this.#disposed = true;
  }

  async #run(): Promise<void> {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#firstChangeAt = null;
    const saving = this.#save().catch((error: unknown) => this.#onError(error));
    this.#saving = saving;
    try {
      await saving;
    } finally {
      this.#saving = null;
      if (this.#changedWhileSaving) {
        this.#changedWhileSaving = false;
        this.notifyChange();
      }
    }
  }
}
