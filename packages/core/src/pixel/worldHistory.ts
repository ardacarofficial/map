import type { HistoryEntry, HistoryListItem, MapStore } from '../store';
import type { PixelRectPatch } from './ops';

export interface WorldParticipant {
  readonly mapId: string;
  readonly entryId: number;
}
export interface WorldHistoryEntry {
  readonly id: number;
  readonly originMapId: string;
  readonly participants: readonly WorldParticipant[];
  /** Shared bytes are owned by one participant's MapStore history, replayed exactly once. */
  readonly pixelPatches: readonly PixelRectPatch[];
  readonly item: HistoryListItem;
  readonly changes: HistoryEntry["changes"];
}
export interface WorldHistoryRow extends WorldHistoryEntry { readonly state: 'done' | 'undone' }

/** Session-only linear history. MapStore retains the owned patches and standalone replay API. */
export class WorldHistory {
  readonly #stores = new Map<string, MapStore>();
  readonly #off = new Map<string, () => void>();
  readonly #seen = new Map<string, number | undefined>();
  readonly #listeners = new Set<() => void>();
  readonly #done: WorldHistoryEntry[] = [];
  readonly #undone: WorldHistoryEntry[] = [];
  #next = 1;
  #replaying = false;
  #batch: WorldParticipant[] | null = null;
  #applyingPlan = false;
  #version = 0;

  get applyingPlan(): boolean { return this.#applyingPlan; }
  get collecting(): boolean { return this.#batch !== null; }
  get replaying(): boolean { return this.#replaying; }
  get version(): number { return this.#version; }
  get undoDepth(): number { return this.#done.length; }
  get redoDepth(): number { return this.#undone.length; }
  get busy(): boolean { return this.#replaying || this.#batch !== null || [...this.#stores.values()].some(s => s.inTransaction); }
  get canUndo(): boolean { return !this.busy && this.#valid(this.#done.at(-1), 'undo'); }
  get canRedo(): boolean { return !this.busy && this.#valid(this.#undone.at(-1), 'redo'); }
  peekUndo(): WorldHistoryEntry | undefined { return this.#done.at(-1); }
  peekRedo(): WorldHistoryEntry | undefined { return this.#undone.at(-1); }
  store(mapId: string): MapStore | undefined { return this.#stores.get(mapId); }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  entries(): readonly WorldHistoryRow[] {
    return [...this.#done.map(e => ({ ...e, state: 'done' as const })), ...[...this.#undone].reverse().map(e => ({ ...e, state: 'undone' as const }))];
  }
  dependsOn(mapId: string): boolean { return this.entries().some(e => e.participants.some(p => p.mapId === mapId)); }

  /** Register before the first user action. Registering again with the same store is harmless. */
  register(mapId: string, store: MapStore): void {
    if (this.#stores.get(mapId) === store) return;
    if (this.#stores.has(mapId)) this.remove(mapId);
    this.#stores.set(mapId, store);
    this.#seen.set(mapId, store.peekUndo()?.id);
    this.#off.set(mapId, store.subscribe(event => {
      if (!event.historyChanged) return;
      const head = store.peekUndo();
      const previous = this.#seen.get(mapId);
      this.#seen.set(mapId, head?.id);
      if (this.#replaying) return;
      if (event.historyReset === 'all') { if (this.dependsOn(mapId)) this.reset(); return; }
      if (event.historyReset === 'redo') { this.#clearRedo(); this.#bump(); return; }
      if (event.cause === 'undo' || event.cause === 'redo') {
        const from = event.cause === 'undo' ? this.#done : this.#undone;
        const to = event.cause === 'undo' ? this.#undone : this.#done;
        const entry = from.at(-1);
        const movedId = event.cause === 'undo' ? store.peekRedo()?.id : store.peekUndo()?.id;
        if (entry?.participants.length === 1 && entry.participants[0]!.mapId === mapId && entry.participants[0]!.entryId === movedId) { from.pop(); to.push(entry); }
      }
      if (event.cause === 'dispatch' || event.cause === 'commit') {
        if (head && head.id !== previous) {
          const participant = Object.freeze({ mapId, entryId: head.id });
          if (this.#batch) this.#batch.push(participant);
          else this.#record(mapId, [participant]);
        }
      }
      this.#bump();
    }));
  }

  /** Group already-prevalidated, synchronously committed participant transactions into one action. */
  compound<T>(originMapId: string, apply: () => T, options: { prepared?: boolean } = {}): T {
    if (this.busy || !this.#stores.has(originMapId)) throw new Error('world history is busy or origin is missing');
    this.#batch = [];
    this.#applyingPlan = options.prepared ?? false;
    try {
      const result = apply();
      const participants = this.#batch;
      this.#batch = null;
      if (participants.length) this.#record(originMapId, participants);
      return result;
    } finally { this.#batch = null; this.#applyingPlan = false; this.#bump(); }
  }

  /** Attach synchronous project-metadata followers to the originating store action. */
  includeFollowers<T>(originMapId: string, apply: () => T): T {
    if (this.#replaying || this.#batch) return apply();
    const original = this.#done.at(-1);
    const originHead = this.#stores.get(originMapId)?.peekUndo()?.id;
    if (!original || original.originMapId !== originMapId || !original.participants.some(p => p.mapId === originMapId && p.entryId === originHead)) return this.compound(originMapId, apply);
    this.#batch = [];
    try {
      const result = apply();
      const followers = this.#batch;
      this.#batch = null;
      if (followers.length) {
        this.#done.pop();
        this.#record(originMapId, [...original.participants, ...followers], original.id);
      }
      return result;
    } finally { this.#batch = null; this.#bump(); }
  }

  undo(): WorldHistoryEntry | null { return this.#move('undo'); }
  redo(): WorldHistoryEntry | null { return this.#move('redo'); }
  undoTo(id: number): number {
    const at = this.#done.findIndex(e => e.id === id);
    if (at < 0) return 0;
    let n = 0;
    while (this.#done.length > at && this.undo()) n++;
    return n;
  }
  redoTo(id: number): number {
    const at = this.#undone.findIndex(e => e.id === id);
    if (at < 0) return 0;
    let n = 0;
    while (this.#undone.length > at && this.redo()) n++;
    return n;
  }
  remove(mapId: string): void {
    if (this.dependsOn(mapId)) this.reset();
    this.#off.get(mapId)?.(); this.#off.delete(mapId);
    this.#stores.delete(mapId); this.#seen.delete(mapId);
    this.#bump();
  }
  /** Explicit destructive reset, used for map deletion/replacement. */
  reset(): void {
    this.#replaying = true;
    try {
      this.#done.length = 0; this.#undone.length = 0;
      for (const store of this.#stores.values()) store.clearHistory();
      for (const [id, store] of this.#stores) this.#seen.set(id, store.peekUndo()?.id);
    } finally { this.#replaying = false; this.#bump(); }
  }
  dispose(): void {
    for (const off of this.#off.values()) off();
    this.#off.clear(); this.#stores.clear(); this.#seen.clear();
    this.#done.length = 0; this.#undone.length = 0; this.#bump();
  }
  #record(originMapId: string, participants: readonly WorldParticipant[], existingId?: number): void {
    // A compound has one committed store entry per map. Raster writes belong to one of them.
    if (new Set(participants.map(p => p.mapId)).size !== participants.length) throw new Error('compound participants must commit once');
    this.#clearRedo();
    const patches: PixelRectPatch[] = [];
    let item: HistoryListItem | undefined;
    let changes: HistoryEntry["changes"] = [];
    for (const p of participants) {
      const store = this.#stores.get(p.mapId)!;
      const entry = store.peekUndo()!;
      if (entry.id !== p.entryId) throw new Error('participant head changed during commit');
      for (const change of entry.changes) if (change.kind === 'pixels') {
        for (const patch of change.patches) {
          const before = patch.before.slice(), after = patch.after.slice();
          patches.push(Object.freeze({ ...patch, get before() { return before.slice(); }, get after() { return after.slice(); } }));
        }
      }
      if (!item || p.mapId === originMapId) { item = store.historyEntries().find(i => i.id === entry.id); changes = entry.changes; }
    }
    const id = existingId ?? this.#next++;
    this.#done.push(Object.freeze({ id, originMapId, participants: Object.freeze([...participants]), pixelPatches: Object.freeze(patches), changes, item: Object.freeze({ ...item!, id }) }));
    // MapStore may evict old entries at its configured capacity. Trim the inaccessible
    // world prefix too, so every displayed undo row is still reachable chronologically.
    let cutoff = -1;
    for (const p of participants) {
      const retained = new Set(this.#stores.get(p.mapId)!.historyEntries().map(e => e.id));
      for (let i = 0; i < this.#done.length; i++) if (this.#done[i]!.participants.some(part => part.mapId === p.mapId && !retained.has(part.entryId))) cutoff = Math.max(cutoff, i);
    }
    if (cutoff >= 0) this.#done.splice(0, cutoff + 1);
    this.#bump();
  }
  #clearRedo(): void {
    this.#replaying = true;
    try { for (const store of this.#stores.values()) store.clearRedo(); }
    finally { this.#replaying = false; }
    this.#undone.length = 0;
  }
  #valid(entry: WorldHistoryEntry | undefined, move: 'undo' | 'redo'): boolean {
    return !!entry && entry.participants.every(p => {
      const store = this.#stores.get(p.mapId);
      const head: HistoryEntry | undefined = move === 'undo' ? store?.peekUndo() : store?.peekRedo();
      return !!store && !store.inTransaction && head?.id === p.entryId;
    });
  }
  #move(move: 'undo' | 'redo'): WorldHistoryEntry | null {
    if (this.busy) return null;
    const from = move === 'undo' ? this.#done : this.#undone, to = move === 'undo' ? this.#undone : this.#done;
    const entry = from.at(-1);
    if (!this.#valid(entry, move)) return null;
    this.#replaying = true;
    try {
      const participants = move === 'undo' ? [...entry!.participants].reverse() : entry!.participants;
      for (const p of participants) this.#stores.get(p.mapId)![move]();
      from.pop(); to.push(entry!);
    } finally { this.#replaying = false; this.#bump(); }
    return entry!;
  }
  #bump(): void { this.#version++; for (const listener of this.#listeners) listener(); }
}
