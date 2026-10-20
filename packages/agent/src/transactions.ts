import type { MapStore } from "@smap/core";
import {
  AGENT_LIMITS as L,
  AgentError,
  AgentErrorCode as E,
  type AgentBaseline,
  type AgentCallContext,
  type AgentEditAdmission,
  type AgentHost,
  type AgentPhase,
  type AgentSignal,
  type AgentState,
  type BeginEditArgs,
  type ChangeSummary,
  type EditLease,
  type Id,
  type PendingWorldGroup,
  type PreparedSmartSource,
  type TransactionSummary,
  type Unsubscribe,
  type WriteContext,
} from "./contracts";
import { budget, check, fail } from "./validation";

export class CallSignal implements AgentSignal {
  aborted = false;
  reason: AgentError = new AgentError(E.CANCELLED, "Call cancelled");
  readonly listeners = new Set<() => void>();
  throwIfAborted(): void {
    if (this.aborted) throw this.reason;
  }
  onAbort(callback: () => void): Unsubscribe {
    if (this.aborted) {
      callback();
      return () => {};
    }
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  abort(reason = this.reason): void {
    if (this.aborted) return;
    this.reason = reason;
    this.aborted = true;
    for (const cb of this.listeners) {
      try {
        cb();
      } catch {
        /* notify every waiter */
      }
    }
    this.listeners.clear();
  }
}
export function waitFor<T>(
  promise: Promise<T>,
  signal: AgentSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let off: Unsubscribe = () => {};
    off = signal.onAbort(() => {
      try {
        signal.throwIfAborted();
      } catch (error) {
        reject(error);
      }
    });
    promise.then(
      (value) => {
        off();
        try {
          signal.throwIfAborted();
          resolve(value);
        } catch (error) {
          reject(error);
        }
      },
      (error) => {
        off();
        reject(error);
      },
    );
  });
}
interface Participant {
  store: MapStore;
  lease: EditLease;
  pin: Unsubscribe;
  target: boolean;
}
export interface PendingEdit {
  summary: TransactionSummary;
  worldId: string;
  epoch: string;
  admission: AgentEditAdmission;
  baseline?: AgentBaseline;
  collector?: PendingWorldGroup;
  participants: Map<Id, Participant>;
  created: Id[];
  protection: Map<string, { locked: boolean; hidden: boolean }>;
  sources: PreparedSmartSource[];
  timer: Unsubscribe;
}

export class Transactions {
  phase: AgentPhase = "ready";
  revision: number;
  committedRevision: number;
  pending: PendingEdit | null = null;
  last: TransactionSummary | null = null;
  readonly terminals = new Map<
    Id,
    { summary: TransactionSummary; at: number }
  >();
  readonly listeners = new Set<(state: AgentState) => void>();
  applying = false;
  independent = false;
  interrupt: (() => void) | undefined;
  onExternal: (() => void) | undefined;
  constructor(readonly host: AgentHost) {
    this.revision = host.session().revision;
    this.committedRevision = this.revision;
    host.subscribeWorldContent(() => {
      this.revision = Math.max(this.revision + 1, host.session().revision);
      if (!this.pending) this.committedRevision = this.revision;
      if (this.pending && !this.applying && !this.independent)
        this.onExternal?.();
      this.emit();
    });
    host.tags.subscribe(() => {
      this.revision++;
      if (!this.pending) this.committedRevision = this.revision;
      this.emit();
    });
  }
  state(): AgentState {
    const s = this.host.session();
    return {
      phase: this.phase,
      instanceId: s.instanceId,
      worldSessionId: s.worldSessionId,
      revision: this.revision,
      committedRevision: this.committedRevision,
      transaction: this.copy(this.pending?.summary ?? this.last),
    };
  }
  copy(s: TransactionSummary | null): TransactionSummary | null {
    return s
      ? {
          ...s,
          owner: { ...s.owner, clientInfo: { ...s.owner.clientInfo } },
          affectedMapIds: [...s.affectedMapIds],
          counters: { ...s.counters },
        }
      : null;
  }
  emit(): void {
    const state = this.state();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        /* state observers cannot break edits */
      }
    }
  }
  world(worldId: string): void {
    const current = this.host.session().worldSessionId;
    check(current !== null, E.NO_WORLD, "No world is open");
    check(worldId === current, E.STALE_WORLD, "World was replaced");
  }
  expected(revision: number): void {
    check(
      revision === this.revision,
      E.REVISION_CONFLICT,
      "Refresh the world revision",
      { expectedRevision: revision, actualRevision: this.revision },
    );
  }
  async begin(args: BeginEditArgs, call: AgentCallContext): Promise<unknown> {
    this.world(args.context.worldSessionId);
    check(!this.pending, E.WRITER_BUSY, "Another edit is pending");
    this.expected(args.expectedRevision);
    this.host.transactions.assertCanBegin();
    for (const id of args.mapIds)
      check(
        this.host.world.maps().some((m) => m.id === id),
        E.UNKNOWN_ID,
        "Unknown map",
      );
    const admission = this.host.transactions.writeGate.acquireEdit(
      args.context.worldSessionId,
    );
    const startedAt = this.host.clock.now();
    const summary: TransactionSummary = {
      id: this.host.ids.next("transaction"),
      state: "preparing",
      label: args.requestLabel,
      owner: {
        clientSessionId: call.clientSessionId,
        clientInfo: { ...call.clientInfo },
      },
      startedAt,
      leaseDeadline: startedAt + L.editLifetimeMs,
      affectedMapIds: [...args.mapIds],
      counters: {
        mutationCalls: 0,
        plannedWrites: 0,
        changedCells: 0,
        retainedBytes: 0,
      },
    };
    const p: PendingEdit = {
      summary,
      worldId: args.context.worldSessionId,
      epoch: call.bridgeEpoch,
      admission,
      participants: new Map(),
      created: [],
      protection: new Map(),
      sources: [],
      timer: () => {},
    };
    this.pending = p;
    this.phase = "preparing";
    this.emit();
    try {
      await waitFor(
        admission.waitForWrites(
          call.signal,
          Math.min(call.deadline, startedAt + L.beginDrainTimeoutMs),
        ),
        call.signal,
      );
      this.assertPreparing(p, call);
      admission.assertCurrent();
      this.expected(args.expectedRevision);
      // Lease every cached store too: direct panel edits on a different tab must fail.
      const ids = [
        ...new Set([
          ...args.mapIds,
          ...this.host.world
            .maps()
            .filter((m) => m.loaded)
            .map((m) => m.id),
        ]),
      ];
      budget(ids.length, L.metadataParticipants + args.mapIds.length);
      for (const id of ids) {
        const store = await waitFor(this.host.loadMap(id), call.signal);
        this.assertPreparing(p, call);
        check(!store.inTransaction, E.WRITER_BUSY, "A map gesture is open");
        const pin = this.host.world.pinMap(id);
        try {
          p.participants.set(id, {
            store,
            pin,
            lease: this.host.transactions.acquireLease(id, store, p),
            target: args.mapIds.includes(id),
          });
        } catch (error) {
          pin();
          throw error;
        }
      }
      for (const [mapId, m] of p.participants)
        for (const layer of m.store.document.layers)
          p.protection.set(`${mapId}:${layer.id}`, {
            locked: layer.locked,
            hidden: !layer.visible,
          });
      this.expected(args.expectedRevision);
      p.baseline = this.host.transactions.captureBaseline(ids);
      p.collector = this.host.transactions.history.beginPending(
        args.mapIds[0]!,
        args.requestLabel,
      );
      this.run(() => {
        for (const participant of p.participants.values())
          participant.store.beginTransaction(args.requestLabel);
      });
      summary.state = "running";
      this.phase = "running";
      p.timer = this.host.clock.schedule(
        Math.max(0, summary.leaseDeadline - this.host.clock.now()),
        () => {
          if (this.pending === p && summary.state === "running")
            this.onExternal?.();
        },
      );
      this.emit();
      return {
        transactionId: summary.id,
        state: "running",
        baseRevision: args.expectedRevision,
        protectedLayers: [...p.participants].flatMap(([mapId, m]) =>
          m.store.document.layers
            .filter((l) => l.locked || !l.visible)
            .map((l) => ({
              mapId,
              layerId: l.id,
              locked: l.locked,
              hidden: !l.visible,
            })),
        ),
        limits: L,
        leaseDeadline: summary.leaseDeadline,
      };
    } catch (error) {
      this.cancel("failed");
      throw error;
    }
  }
  assertPreparing(p: PendingEdit, call: AgentCallContext): void {
    call.signal.throwIfAborted();
    this.world(p.worldId);
    check(
      this.pending === p && this.phase === "preparing",
      E.CANCELLED,
      "Preparation was cancelled",
    );
  }
  owned(
    context: WriteContext,
    call: AgentCallContext,
    sealed = false,
    skipRevision = false,
  ): PendingEdit {
    this.world(context.worldSessionId);
    const p = this.pending;
    if (!p) {
      const terminal = this.terminals.get(context.transactionId)?.summary;
      if (terminal?.state === "cancelled")
        fail(E.TRANSACTION_CANCELLED, "Transaction was cancelled");
      fail(E.TRANSACTION_REQUIRED, "Begin an edit first");
    }
    check(
      p.summary.owner.clientSessionId === call.clientSessionId &&
        p.summary.id === context.transactionId &&
        p.epoch === call.bridgeEpoch,
      E.TRANSACTION_NOT_OWNED,
      "Transaction belongs to another client or epoch",
    );
    check(
      sealed || p.summary.state === "running",
      E.TRANSACTION_SEALED,
      "Transaction is sealed",
    );
    if (!skipRevision) this.expected(context.expectedRevision);
    call.signal.throwIfAborted();
    return p;
  }
  store(mapId: string): MapStore {
    const p = this.pending!;
    const participant = p.participants.get(mapId);
    check(participant?.target, E.UNKNOWN_ID, "Map is not a transaction target");
    return participant.store;
  }
  /** Cached/read-loaded metadata followers participate in the same outer action.
   * This is eager for cached stores so host publication can stay synchronous. */
  enlist(mapId: string, store: MapStore): void {
    const p = this.pending;
    if (!p || p.participants.has(mapId)) return;
    budget(p.participants.size + 1, L.metadataParticipants + L.targetMaps);
    check(
      !store.inTransaction,
      E.WRITER_BUSY,
      "A metadata follower has an open gesture",
    );
    const baseline = this.host.transactions.captureBaseline([mapId]);
    const pin = this.host.world.pinMap(mapId);
    let lease: EditLease;
    try {
      lease = this.host.transactions.acquireLease(mapId, store, p);
    } catch (error) {
      pin();
      throw error;
    }
    p.participants.set(mapId, { store, pin, lease, target: false });
    if (p.baseline)
      p.baseline = {
        ...p.baseline,
        maps: [...p.baseline.maps, ...baseline.maps],
      };
    for (const layer of store.document.layers)
      p.protection.set(`${mapId}:${layer.id}`, {
        locked: layer.locked,
        hidden: !layer.visible,
      });
    this.run(() => {
      store.beginTransaction(p.summary.label);
      for (const source of p.sources)
        for (const tileset of source.tilesets)
          if (!store.document.getTileset(tileset.id))
            store.dispatch({ type: "addTileset", tileset, undoable: true });
    });
  }
  async enlistCached(call: AgentCallContext): Promise<void> {
    for (const map of this.host.world.maps())
      if (map.loaded && !this.pending!.participants.has(map.id)) {
        const store = await waitFor(this.host.loadMap(map.id), call.signal);
        this.world(this.pending!.worldId);
        call.signal.throwIfAborted();
        this.enlist(map.id, store);
      }
  }
  run<T>(apply: () => T): T {
    const old = this.applying;
    this.applying = true;
    const leases = [...this.pending!.participants.values()].map((m) => m.lease);
    // The core capability forbids async functions; this internal scope only wraps synchronous code.
    const nested = (index: number): T =>
      index === leases.length
        ? apply()
        : leases[index]!.run(
            () =>
              nested(index + 1) as T extends PromiseLike<unknown> ? never : T,
          );
    try {
      return nested(0);
    } finally {
      this.applying = old;
    }
  }
  charge(planned: number, retained = planned * 32): void {
    const c = this.pending!.summary.counters;
    budget(planned);
    budget(c.mutationCalls + 1, L.mutationCalls);
    budget(c.plannedWrites + planned, L.transactionPlannedWrites);
    budget(c.retainedBytes + retained, L.retainedBytes);
  }
  record(change: ChangeSummary, retained = change.plannedCells * 32): void {
    const c = this.pending!.summary.counters;
    c.mutationCalls++;
    c.plannedWrites += change.plannedCells;
    c.changedCells += change.changedCells;
    c.retainedBytes += retained;
    this.emit();
  }
  seal(state: "stopped" | "awaitingApproval"): void {
    if (!this.pending || this.phase === "preparing") {
      this.interrupt?.();
      return;
    }
    if (this.pending.summary.state !== "running") return;
    this.pending.summary.state = state;
    this.phase = state;
    this.interrupt?.();
    this.emit();
  }
  diagnostic(summary: string, mapIds: string[] = []): void {
    try {
      this.host.activity.append({
        id: this.host.ids.next("activity"),
        timestamp: this.host.clock.now(),
        clientInfo: null,
        clientSessionId: null,
        tool: null,
        requestId: null,
        transactionId: this.pending?.summary.id ?? this.last?.id ?? null,
        mapIds,
        status: "failed",
        plannedCells: 0,
        changedCells: 0,
        durationMs: 0,
        code: E.INTERNAL_ERROR,
        summary,
      });
    } catch {
      /* Diagnostic observers cannot alter a completed history action. */
    }
  }
  approve(): void {
    const p = this.pending;
    if (!p) return;
    if (this.phase === "preparing") {
      this.cancel();
      return;
    }
    try {
      for (const source of p.sources)
        this.host.smartSources.assertCurrent(source);
    } catch (error) {
      this.cancel();
      throw error;
    }
    for (const m of p.participants.values())
      check(
        m.store.transactionDepth === 1,
        E.INTERNAL_ERROR,
        "Unbalanced helper transaction",
      );
    const row = this.run(() =>
      p.collector!.finish(() => {
        for (const [mapId, m] of p.participants) {
          const head = m.store.peekUndo()?.id;
          try {
            m.store.commit();
          } catch (error) {
            // Store observers may throw after a successful commit. Never retry that commit.
            if (
              m.store.inTransaction ||
              (m.store.peekUndo()?.id === head &&
                m.store.transactionDepth !== 0)
            )
              throw error;
            this.diagnostic("Commit observer failed after the map committed", [
              mapId,
            ]);
          }
        }
        // Journal operations were already staged. A publication listener cannot
        // turn a completed local commit into a retryable failed approval.
        try {
          this.host.metadata.publish();
        } catch {
          this.diagnostic("Metadata publication observer failed");
        }
        for (const id of p.created) this.host.world.approveProvisionalMap(id);
      }, this.host.metadata.patch()),
    );
    p.summary.state = "approved";
    p.summary.outcome = "approved";
    if (row) p.summary.historyEntryId = row.id;
    this.complete("approved");
  }
  cancel(admissionOutcome: "cancelled" | "failed" = "cancelled"): void {
    const p = this.pending;
    if (!p) return;
    this.phase = "cancelling";
    p.summary.state = "cancelling";
    this.emit();
    const rollback = () => {
      for (const m of [...p.participants.values()].reverse())
        if (m.store.inTransaction) {
          try {
            m.store.rollback();
          } catch (error) {
            if (m.store.inTransaction) throw error;
          }
        }
      if (this.host.session().worldSessionId === p.worldId) {
        if (p.baseline) {
          this.host.metadata.restore(p.baseline.metadata);
          this.host.transactions.restoreBaseline(p.baseline);
        }
        for (const id of p.created) this.host.world.removeProvisionalMap(id);
      }
    };
    this.run(() => {
      if (p.collector) p.collector.cancel(rollback);
      else rollback();
    });
    p.summary.state = "cancelled";
    p.summary.outcome = "cancelled";
    this.complete("cancelled", admissionOutcome);
  }
  complete(
    outcome: "approved" | "cancelled",
    admissionOutcome: "approved" | "cancelled" | "failed" = outcome,
  ): void {
    const p = this.pending!;
    p.timer();
    this.host.smartSources.releaseTransaction(p.summary.id, outcome);
    for (const m of p.participants.values()) {
      m.lease.release();
      m.pin();
    }
    this.last = this.copy(p.summary);
    this.terminals.set(p.summary.id, {
      summary: this.last!,
      at: this.host.clock.now(),
    });
    this.pending = null;
    this.phase = "ready";
    this.revision++;
    this.committedRevision = this.revision;
    try {
      p.admission.release(admissionOutcome);
    } catch (error) {
      if (this.host.transactions.writeGate.blocked) throw error;
      this.diagnostic("Admission release observer failed");
    }
    try {
      this.host.transactions.finalized(outcome);
    } catch {
      this.diagnostic("Finalization observer failed");
    }
    this.emit();
  }
}
