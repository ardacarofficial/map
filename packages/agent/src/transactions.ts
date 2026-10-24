import { type Entity, type MapStore } from "@smap/core";
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
import { RegionCollaboration, type CollaborativeJoin } from "./collaboration";
import { CollaborationJournal, type CollaborativeCall } from "./collaborationJournal";
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
export const layerProtectionKey = (mapId: Id, layerId: Id): string =>
  JSON.stringify([mapId, layerId]);
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
  invalidated: boolean;
  timer: Unsubscribe;
  collaboration?: RegionCollaboration;
  journal?: CollaborationJournal;
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
  memberCall: { journal: CollaborativeCall; counters: TransactionSummary["counters"]; memberCounters: TransactionSummary["counters"]; reserved: number; finished?: boolean } | undefined;
  planning = false;
  applying = false;
  independent = false;
  interrupt: (() => void) | undefined;
  onExternal: (() => void) | undefined;
  private readonly subscriptions: Unsubscribe[] = [];
  constructor(readonly host: AgentHost) {
    this.revision = host.session().revision;
    this.committedRevision = this.revision;
    this.subscriptions.push(host.subscribeWorldContent(() => {
      this.revision = Math.max(this.revision + 1, host.session().revision);
      if (!this.pending) this.committedRevision = this.revision;
      if (this.pending && !this.applying && !this.independent) {
        this.pending.invalidated = true;
        this.onExternal?.();
      }
      this.emit();
    }));
    this.subscriptions.push(host.tags.subscribe(() => {
      this.revision++;
      if (!this.pending) this.committedRevision = this.revision;
      this.emit();
    }));
  }
  dispose(): void {
    for (const off of this.subscriptions.splice(0)) off();
    this.pending?.timer();
    this.listeners.clear();
    this.terminals.clear();
    this.interrupt = undefined;
    this.onExternal = undefined;
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
          ...(this.pending?.summary===s && this.pending.collaboration ? {collaboration:this.pending.collaboration.snapshot()}:s.collaboration?{collaboration:JSON.parse(JSON.stringify(s.collaboration)) as NonNullable<TransactionSummary["collaboration"]>}:{}),
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
      invalidated: false,
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
          p.protection.set(layerProtectionKey(mapId, layer.id), {
            locked: layer.locked,
            hidden: !layer.visible,
          });
      this.expected(args.expectedRevision);
      if(args.collaboration){
        p.collaboration=new RegionCollaboration(this.host.ids.next("member"),call,args.collaboration.claims,id=>this.store(id));
        p.journal=new CollaborationJournal(p.collaboration,id=>this.store(id));
      }
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
          if (this.pending === p && summary.state === "running") {
            if(p.collaboration){
              p.collaboration.reviewReason="The shared draft time limit expired; contributions are retained for human review";
              this.seal("stopped");
              try{this.host.activity.append({id:this.host.ids.next("activity"),timestamp:this.host.clock.now(),clientInfo:null,clientSessionId:null,tool:null,requestId:null,transactionId:p.summary.id,mapIds:p.summary.affectedMapIds,status:"stopped",plannedCells:p.summary.counters.plannedWrites,changedCells:p.summary.counters.changedCells,durationMs:0,summary:p.collaboration.reviewReason});}catch{/* Expiry cannot strand the reviewable draft. */}
            }else this.onExternal?.();
          }
        },
      );
      this.emit();
      return {
        transactionId: summary.id,
        ...(p.collaboration?{memberId:p.collaboration.coordinatorId,memberRevision:0,revisionMode:"member"}:{}),
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
    check(p.summary.id === context.transactionId && p.epoch === call.bridgeEpoch,
      E.TRANSACTION_NOT_OWNED, "Transaction belongs to another client or epoch");
    if(p.collaboration) {
      const member=p.collaboration.require(call,sealed);
      if(context.expectedMemberRevision!==undefined)p.collaboration.expect(member,context.expectedMemberRevision);
      else { check(context.expectedRevision!==undefined,E.INVALID_ARGUMENT,"Choose an explicit global or member revision token"); this.expected(context.expectedRevision); }
    } else {
      check(p.summary.owner.clientSessionId===call.clientSessionId,E.TRANSACTION_NOT_OWNED,"Transaction belongs to another client");
      if(!skipRevision){check(context.expectedRevision!==undefined,E.INVALID_ARGUMENT,"Exclusive edits require expectedRevision");this.expected(context.expectedRevision);}
    }
    check(sealed || p.summary.state === "running",E.TRANSACTION_SEALED,"Transaction is sealed");
    call.signal.throwIfAborted();
    return p;
  }
  async join(args: CollaborativeJoin,call:AgentCallContext):Promise<unknown>{
    this.world(args.context.worldSessionId);this.expected(args.expectedRevision);
    const p=this.pending;check(p&&p.summary.id===args.transactionId&&p.epoch===call.bridgeEpoch,E.TRANSACTION_REQUIRED,"No matching collaborative draft");
    check(p.summary.state==="running",E.TRANSACTION_SEALED,"Draft is sealed");
    check(p.collaboration,E.INVALID_ARGUMENT,"This is an exclusive draft");call.signal.throwIfAborted();
    const m=p.collaboration.join(this.host.ids.next("member"),call,args.claims);this.emit();
    return {transactionId:p.summary.id,memberId:m.id,memberRevision:m.revision,state:"running",claims:m.claims,revisionMode:"member"};
  }
  memberFor(call:Pick<AgentCallContext,"clientSessionId">){return this.pending?.collaboration?.bySession(call.clientSessionId);}
  memberRevision(call:Pick<AgentCallContext,"clientSessionId">,transactionId?:Id):{memberId:Id;memberRevision:number}|undefined{
    const m=this.memberFor(call)??(transactionId?this.terminals.get(transactionId)?.summary.collaboration?.members.find(member=>member.clientSessionId===call.clientSessionId):undefined);return m?{memberId:m.id,memberRevision:m.revision}:undefined;
  }
  beginMemberCall(call:AgentCallContext):void{
    const p=this.pending;if(!p?.collaboration)return;const m=p.collaboration.require(call);
    this.memberCall={journal:p.journal!.begin(m.id),counters:{...p.summary.counters},memberCounters:{...m.counters},reserved:0};
  }
  reserveMemberCall(bytes:number):void{if(this.memberCall&&!this.planning)this.memberCall.reserved=Math.max(this.memberCall.reserved,bytes);}
  authorizeCells(mapId:Id,layerId:Id,points:readonly {x:number;y:number}[]):void{
    const p=this.pending;if(!p?.collaboration)return;check(this.memberCall,E.INTERNAL_ERROR,"Missing collaborative call scope");
    if(this.planning)p.collaboration.assertCells(this.memberCall.journal.memberId,mapId,layerId,points);
    else p.journal!.cells(this.memberCall.journal,mapId,layerId,points);
  }
  authorizeEntity(mapId:Id,layerId:Id,before:Entity|null,after:Entity|null):void{
    const p=this.pending;if(!p?.collaboration)return;check(this.memberCall,E.INTERNAL_ERROR,"Missing collaborative call scope");
    if(this.planning){if(before)p.collaboration.assertEntity(this.memberCall.journal.memberId,mapId,layerId,before);if(after)p.collaboration.assertEntity(this.memberCall.journal.memberId,mapId,layerId,after);}
    else p.journal!.entity(this.memberCall.journal,mapId,layerId,before,after);
  }
  assertGlobal(call:AgentCallContext):void{const p=this.pending;if(p?.collaboration)p.collaboration.assertGlobal(p.collaboration.require(call).id);}
  finishMemberCall():void{
    const scope=this.memberCall,p=this.pending;if(!scope||!p?.collaboration||scope.finished)return;scope.finished=true;
    const m=p.collaboration.members.get(scope.journal.memberId)!;if(scope.journal.cells.size||scope.journal.entities.size)p.collaboration.spatialStarted=true;m.revision++;m.counters.retainedBytes+=scope.journal.addedBytes;p.summary.counters.retainedBytes+=scope.journal.addedBytes;this.emit();
  }
  releaseMemberCall():void{this.memberCall=undefined;}
  recoverMemberCall():void{
    const scope=this.memberCall,p=this.pending;this.memberCall=undefined;if(!scope||!p?.collaboration)return;
    if(scope.journal.applied){
      try{this.run(()=>p.journal!.recover(scope.journal));p.summary.counters={...scope.counters};const m=p.collaboration.members.get(scope.journal.memberId)!;m.counters={...scope.memberCounters};m.revision++;}
      catch{p.invalidated=true;p.collaboration.stopAll("Local recovery failed; human group discard is required");p.summary.state="stopped";this.phase="stopped";}
    }
    this.emit();
  }
  finishMember(call:AgentCallContext,summary:string):unknown{
    const p=this.pending!;const m=p.collaboration!.require(call);p.collaboration!.finish(m);this.updateCollaborativePhase();
    return{transactionId:p.summary.id,state:p.summary.state,memberId:m.id,memberState:"ready",summary,counters:{...m.counters},requiresUserApproval:true};
  }
  cancelMember(clientSessionId:Id,detach=false):void{
    const p=this.pending,collaboration=p?.collaboration,m=collaboration?.bySession(clientSessionId);if(!p||!collaboration||!m)return;if(m.state==="cancelled"){if(detach)this.detachMember(clientSessionId);return;}
    this.memberCall=undefined;collaboration.beginCancel(m);this.emit();
    try{this.run(()=>p.journal!.cancel(m.id));collaboration.cancelled(m,detach);if(detach&&p.summary.owner.clientSessionId===clientSessionId)p.summary.owner.clientSessionId=null;}
    catch{p.invalidated=true;collaboration.stopAll("Member rollback failed; human group discard is required");p.summary.state="stopped";this.phase="stopped";this.emit();throw new AgentError(E.INTERNAL_ERROR,"Member rollback failed; peer contributions were retained for human discard");}
    try{this.host.activity.append({id:this.host.ids.next("activity"),timestamp:this.host.clock.now(),memberId:m.id,clientInfo:m.clientInfo,clientSessionId,tool:null,requestId:null,transactionId:p.summary.id,mapIds:[...new Set(m.claims.map(claim=>claim.mapId))],status:"cancelled",plannedCells:m.counters.plannedWrites,changedCells:m.counters.changedCells,durationMs:0,summary:detach?"Disconnected member contribution rolled back":"Member contribution rolled back"});}catch{/* Activity observers cannot undo completed local recovery. */}
    this.updateCollaborativePhase();
  }
  detachMember(clientSessionId:Id):void{
    const p=this.pending,m=p?.collaboration?.bySession(clientSessionId);if(!p||!m)return;p.collaboration!.detach(m);if(p.summary.owner.clientSessionId===clientSessionId)p.summary.owner.clientSessionId=null;this.emit();
  }
  private updateCollaborativePhase():void{
    const p=this.pending!;if(p.collaboration!.allFinished){p.summary.state="awaitingApproval";this.phase="awaitingApproval";}this.emit();
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
      p.protection.set(layerProtectionKey(mapId, layer.id), {
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
  async enlistCached(call: Pick<AgentCallContext, "signal">): Promise<void> {
    const p = this.pending!;
    for (const map of this.host.world.maps())
      if (map.loaded && !p.participants.has(map.id)) {
        const store = await waitFor(this.host.loadMap(map.id), call.signal);
        this.world(p.worldId);
        call.signal.throwIfAborted();
        check(this.pending === p && !p.invalidated, E.CANCELLED,
          "World changed while enlisting maps");
        this.enlist(map.id, store);
      }
  }
  run<T>(apply: () => T): T {
    if(this.memberCall && !this.planning)this.pending!.journal!.capture(this.memberCall.journal,bytes=>budget(this.pending!.summary.counters.retainedBytes+this.memberCall!.reserved+this.memberCall!.journal.addedBytes+bytes,L.retainedBytes));
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
  /** perCall defaults to the sparse-write cap; uniform/grid tools pass their own per-call limit. */
  charge(planned: number, retained = planned * 32, perCall: number = L.cellsPerCall): void {
    const c = this.pending!.summary.counters;
    budget(planned, perCall);
    budget(c.mutationCalls + 1, L.mutationCalls);
    budget(c.plannedWrites + planned, L.transactionPlannedWrites);
    budget(c.retainedBytes + retained, L.retainedBytes);
    if(this.memberCall&&!this.planning)this.memberCall.reserved=Math.max(this.memberCall.reserved,retained);
  }
  record(change: ChangeSummary, retained = change.plannedCells * 32): void {
    const c = this.pending!.summary.counters;
    c.mutationCalls++;
    c.plannedWrites += change.plannedCells;
    c.changedCells += change.changedCells;
    c.retainedBytes += retained;
    if(this.memberCall&&!this.planning){const m=this.pending!.collaboration!.members.get(this.memberCall.journal.memberId)!;m.counters.mutationCalls++;m.counters.plannedWrites+=change.plannedCells;m.counters.changedCells+=change.changedCells;m.counters.retainedBytes+=retained;}
    this.emit();
  }
  seal(state: "stopped" | "awaitingApproval"): void {
    if (!this.pending || this.phase === "preparing") {
      this.interrupt?.();
      return;
    }
    if (this.pending.summary.state !== "running") return;
    this.pending.collaboration?.stopAll();
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
    // External invalidation queues rollback behind the active call. Approval may
    // have yielded while loading a follower, so reject before any local commit.
    if (p.invalidated) {
      if(p.collaboration)fail(E.CANCELLED,"Collaborative draft is stopped for human discard after an external change");
      this.cancel();
      fail(E.CANCELLED, "World changed before approval");
    }
    if (this.phase === "preparing") {
      this.cancel();
      return;
    }
    try {
      for (const source of p.sources)
        this.host.smartSources.assertCurrent(source);
    } catch (error) {
      if(p.collaboration){p.collaboration.stopAll("A shared source changed; discard or resolve the source before approval");this.phase="stopped";p.summary.state="stopped";this.emit();throw error;}
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
    if(p.collaboration){for(const member of p.collaboration.members.values())if(member.state!=="cancelled"){member.state="cancelled";member.revision++;}}
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
    try {
      this.run(() => this.host.smartSources.releaseTransaction(p.summary.id, outcome));
    } catch {
      // Source publication already succeeded or rolled back. Asset-retirement
      // observers must not strand ownership after that completed history action.
      this.diagnostic("Source release failed after transaction finalization");
    } finally {
      for (const m of p.participants.values()) {
        m.lease.release();
        m.pin();
      }
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
