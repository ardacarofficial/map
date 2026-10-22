/** Shared-draft memberships and spatial permissions. Core retains one outer world transaction. */
import { isEntityLayer, type Entity, type MapStore } from "@smap/core";
import { AGENT_LIMITS, AgentError, type AgentCallContext, type AgentErrorCode, type ClientInfo, type Id, type Point, type Rect, type TransactionCounters } from "./contracts";

export interface RegionClaim { mapId: Id; layerIds: Id[]; region: Rect }
export type CollaborationMemberState = "running" | "ready" | "stopped" | "cancelling" | "cancelled";
export interface CollaborationMemberSummary {
  id: Id; clientSessionId: Id | null; clientInfo: ClientInfo; role: "coordinator" | "member";
  state: CollaborationMemberState; revision: number; claims: RegionClaim[];
  counters: TransactionCounters; detached: boolean;
}
export interface CollaborationSummary { mode: "regions"; joinOpen: boolean; members: CollaborationMemberSummary[]; reviewReason?: string; fault?: string }
export interface CollaborativeBegin { mode: "regions"; claims?: RegionClaim[] }
export interface CollaborativeJoin {
  context: { worldSessionId: Id }; transactionId: Id; idempotencyKey: string;
  expectedRevision: number; claims: RegionClaim[];
}
interface Member extends CollaborationMemberSummary { epoch: string; claimed: boolean }
const EMPTY_COUNTERS = (): TransactionCounters => ({ mutationCalls: 0, plannedWrites: 0, changedCells: 0, retainedBytes: 0 });
function refuse(code: string, message: string, details: Record<string, string | number | boolean> = {}): never {
  throw new AgentError(code as AgentErrorCode, message, details);
}
function copyClaim(claim: RegionClaim): RegionClaim { return { mapId: claim.mapId, layerIds: [...claim.layerIds], region: { ...claim.region } }; }
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const contains = (region: Rect, at: Point) => at.x >= region.x && at.y >= region.y && at.x < region.x + region.width && at.y < region.y + region.height;

/** This object owns membership only; it never acquires another MapStore transaction. */
export class RegionCollaboration {
  readonly members = new Map<Id, Member>();
  readonly coordinatorId: Id;
  joinOpen = true;
  hasJoined = false;
  spatialStarted = false;
  fault: string | undefined;
  reviewReason: string | undefined;
  private readonly spawnOwners = new Map<Id, Id>();

  constructor(coordinatorId: Id, call: Pick<AgentCallContext, "clientSessionId" | "clientInfo" | "bridgeEpoch">,
    claims: RegionClaim[] | undefined, private readonly store: (mapId: Id) => MapStore) {
    this.coordinatorId = coordinatorId;
    this.members.set(coordinatorId, { id: coordinatorId, clientSessionId: call.clientSessionId, clientInfo: { ...call.clientInfo },
      role: "coordinator", state: "running", revision: 0, claims: [], counters: EMPTY_COUNTERS(), detached: false,
      epoch: call.bridgeEpoch, claimed: false });
    if (claims !== undefined) this.assign(this.members.get(coordinatorId)!, claims);
  }
  snapshot(): CollaborationSummary {
    return { mode: "regions", joinOpen: this.joinOpen, members: [...this.members.values()].map(member => ({
      id: member.id, clientSessionId: member.clientSessionId, clientInfo: { ...member.clientInfo }, role: member.role,
      state: member.state, revision: member.revision, claims: member.claims.map(copyClaim), counters: { ...member.counters }, detached: member.detached,
    })), ...(this.reviewReason?{reviewReason:this.reviewReason}:{}), ...(this.fault ? { fault: this.fault } : {}) };
  }
  bySession(clientSessionId: Id): Member | undefined { return [...this.members.values()].find(member => member.clientSessionId === clientSessionId); }
  require(call: Pick<AgentCallContext, "clientSessionId" | "bridgeEpoch">, allowFinished = false): Member {
    const member = this.bySession(call.clientSessionId);
    if (!member || member.epoch !== call.bridgeEpoch) refuse("TRANSACTION_NOT_OWNED", "Join this collaborative draft before writing");
    if (member.state === "cancelled") refuse("TRANSACTION_CANCELLED", "This member's contribution was cancelled");
    if (!allowFinished && member.state !== "running") refuse("TRANSACTION_SEALED", "This member has finished or stopped");
    if (this.fault) refuse("TRANSACTION_SEALED", "The collaborative draft is stopped for human recovery", { reason: this.fault });
    return member;
  }
  expect(member: Member, revision: number): void {
    if (revision !== member.revision) refuse("MEMBER_REVISION_CONFLICT", "Refresh this member's write revision", { expectedMemberRevision: revision, actualMemberRevision: member.revision });
  }
  join(id: Id, call: Pick<AgentCallContext, "clientSessionId" | "clientInfo" | "bridgeEpoch">, claims: RegionClaim[]): Member {
    if (!this.joinOpen || this.fault) refuse("TRANSACTION_SEALED", "This draft is closed to new members");
    const existing = this.bySession(call.clientSessionId);
    if (existing) {
      if (existing.id !== this.coordinatorId || existing.claimed || existing.state !== "running" || this.hasJoined || existing.epoch !== call.bridgeEpoch)
        refuse("INVALID_ARGUMENT", "Members cannot rejoin or change assigned regions");
      this.assign(existing, claims); existing.revision++; return existing;
    }
    const coordinator = this.members.get(this.coordinatorId)!;
    if (!coordinator.claimed) refuse("WRITER_BUSY", "The coordinator must assign its own regions before inviting peers");
    if (this.members.size >= 16) refuse("LIMIT_EXCEEDED", "This draft already has 16 members");
    const member: Member = { id, clientSessionId: call.clientSessionId, clientInfo: { ...call.clientInfo }, role: "member", state: "running",
      revision: 0, claims: [], counters: EMPTY_COUNTERS(), detached: false, epoch: call.bridgeEpoch, claimed: false };
    this.assign(member, claims); this.members.set(id, member); this.hasJoined = true; return member;
  }
  private assign(member: Member, claims: RegionClaim[]): void {
    if (!claims.length || claims.length > 16) refuse("LIMIT_EXCEEDED", "Select between 1 and 16 region claims");
    for (const claim of claims) {
      const doc = this.store(claim.mapId).document, b = claim.region;
      if (!Number.isInteger(b.x) || !Number.isInteger(b.y) || !Number.isInteger(b.width) || !Number.isInteger(b.height) ||
          b.x < 0 || b.y < 0 || b.width < 1 || b.height < 1 || b.x + b.width > doc.map.width || b.y + b.height > doc.map.height)
        refuse("OUT_OF_BOUNDS", "Claim exceeds its target map");
      if (!claim.layerIds.length || claim.layerIds.length > 8 || new Set(claim.layerIds).size !== claim.layerIds.length)
        refuse("INVALID_ARGUMENT", "Claims need 1–8 unique layer IDs");
      for (const layerId of claim.layerIds) if (!doc.getLayer(layerId)) refuse("UNKNOWN_ID", "Claim references an unknown target layer");
      for (const peer of this.members.values()) if (peer.id !== member.id && peer.state !== "cancelled")
        for (const other of peer.claims) if (other.mapId === claim.mapId && intersects(other.region, b) && other.layerIds.some(id => claim.layerIds.includes(id)))
          refuse("REGION_CONFLICT", "A peer already owns an overlapping region on this layer", { memberId: peer.id, mapId: claim.mapId });
    }
    member.claims = claims.map(copyClaim); member.claimed = true;
  }
  assertCells(memberId: Id, mapId: Id, layerId: Id, points: readonly Point[]): void {
    const member = this.members.get(memberId)!;
    for (const point of points) if (!member.claims.some(claim => claim.mapId === mapId && claim.layerIds.includes(layerId) && contains(claim.region, point)))
      refuse("OUTSIDE_REGION", "Every planned write, including neighbor repairs, must fit this member's claims", { memberId, mapId, layerId, x: point.x, y: point.y });
  }
  assertEntity(memberId: Id, mapId: Id, layerId: Id, entity: Entity): void {
    const map = this.store(mapId).document.map;
    // Entity coverage includes its visible rectangle, not just its anchor.
    const x = Math.floor(entity.x / map.tileWidth), y = Math.floor(entity.y / map.tileHeight);
    const right = Math.min(map.width, Math.ceil((entity.x + (entity.width ?? map.tileWidth)) / map.tileWidth));
    const bottom = Math.min(map.height, Math.ceil((entity.y + (entity.height ?? map.tileHeight)) / map.tileHeight));
    if (![x,y,right,bottom].every(Number.isSafeInteger) || x < 0 || y < 0 || x >= map.width || y >= map.height || right <= x || bottom <= y)
      refuse("OUT_OF_BOUNDS", "Entity footprint must intersect a valid map region");
    if ((right-x)*(bottom-y) > AGENT_LIMITS.cellsPerCall) refuse("LIMIT_EXCEEDED", "Entity footprint exceeds the spatial-call budget");
    const points: Point[] = [];
    for (let cy = y; cy < bottom; cy++) for (let cx = x; cx < right; cx++) points.push({ x: cx, y: cy });
    this.assertCells(memberId, mapId, layerId, points);
    if (entity.typeId === "spawn") {
      const owner = this.spawnOwners.get(mapId);
      if (owner && owner !== memberId) refuse("REGION_CONFLICT", "Another member owns this map's spawn constraint", { memberId: owner, mapId });
    }
  }
  claimSpawn(memberId: Id, mapId: Id): boolean { const fresh=!this.spawnOwners.has(mapId);this.spawnOwners.set(mapId, memberId);return fresh; }
  releaseSpawn(memberId:Id,mapId:Id):void{if(this.spawnOwners.get(mapId)===memberId)this.spawnOwners.delete(mapId);}
  assertGlobal(memberId: Id): void {
    if (memberId !== this.coordinatorId || this.hasJoined || this.spatialStarted) refuse("EXCLUSIVE_OPERATION_REQUIRED", "Prepare shared metadata as coordinator before spatial painting or peer joins");
  }
  finish(member: Member): void {
    member.state = "ready"; member.revision++;
    if (member.id === this.coordinatorId) this.joinOpen = false;
  }
  stopAll(reason?: string): void {
    this.joinOpen = false;
    if (reason) this.fault = reason;
    for (const member of this.members.values()) if (member.state === "running") member.state = "stopped";
  }
  get allFinished(): boolean { return !this.joinOpen && [...this.members.values()].every(member => member.state !== "running" && member.state !== "cancelling"); }
  beginCancel(member: Member): void { member.state = "cancelling"; }
  cancelled(member: Member, detach: boolean): void {
    member.state = "cancelled"; member.revision++;
    if (member.id === this.coordinatorId) this.joinOpen = false;
    if (detach) { member.clientSessionId = null; member.detached = true; }
    for (const [mapId, owner] of this.spawnOwners) if (owner === member.id) this.spawnOwners.delete(mapId);
  }
  detach(member: Member): void { member.clientSessionId = null; member.detached = true; }
}

export interface JournalCell extends Point { mapId: Id; layerId: Id; before: number }
export interface JournalEntity { mapId: Id; layerId: Id; id: Id; before: Entity | null }
export interface SpatialJournal { cells: Map<string, JournalCell>; entities: Map<string, JournalEntity> }
export const spatialJournal = (): SpatialJournal => ({ cells: new Map(), entities: new Map() });
export const cellJournalKey = (mapId: Id, layerId: Id, at: Point): string => JSON.stringify([mapId, layerId, at.x, at.y]);
export const entityJournalKey = (mapId: Id, entityId: Id): string => JSON.stringify([mapId, entityId]);

/** Apply only the caller's inverse through normal core operations under the shared outer lease. */
export function restoreSpatialJournal(journal: SpatialJournal, store: (mapId: Id) => MapStore,
  entityOrder: ReadonlyMap<string, readonly Id[]>): void {
  const layers = new Map<string, JournalCell[]>();
  for (const cell of journal.cells.values()) {
    const key = JSON.stringify([cell.mapId, cell.layerId]), list = layers.get(key) ?? [];
    list.push(cell); layers.set(key, list);
  }
  for (const cells of layers.values()) {
    const first = cells[0]!, target = store(first.mapId), layer = target.document.getLayer(first.layerId);
    if (!layer || isEntityLayer(layer)) refuse("INTERNAL_ERROR", "A journaled region layer is unavailable");
    for (let offset = 0; offset < cells.length; offset += AGENT_LIMITS.cellsPerCall) {
      const batch = cells.slice(offset, offset + AGENT_LIMITS.cellsPerCall);
      if (layer.type === "grid") target.dispatch({ type: "paintGrid", layerId: layer.id, cells: batch.map(cell => ({ x: cell.x, y: cell.y, value: cell.before })) });
      else target.dispatch({ type: "paintCells", layerId: layer.id, cells: batch.map(cell => ({ x: cell.x, y: cell.y, cell: cell.before })) });
    }
  }
  // Remove current versions first so spawn uniqueness and removed IDs restore consistently.
  for (const entry of journal.entities.values()) {
    const target = store(entry.mapId);
    if (target.document.findEntity(entry.id)) target.dispatch({ type: "removeEntity", entityId: entry.id });
  }
  const ranks=new Map<string,Map<Id,number>>();
  const rankFor=(mapId:Id,layerId:Id)=>{const key=JSON.stringify([mapId,layerId]);let rank=ranks.get(key);if(!rank){rank=new Map((entityOrder.get(key)??[]).map((id,index)=>[id,index]));ranks.set(key,rank);}return rank;};
  const restored = [...journal.entities.values()].filter((entry): entry is JournalEntity & { before: Entity } => !!entry.before);
  restored.sort((a,b)=>a.mapId.localeCompare(b.mapId)||a.layerId.localeCompare(b.layerId)||(rankFor(a.mapId,a.layerId).get(a.id)??Infinity)-(rankFor(b.mapId,b.layerId).get(b.id)??Infinity));
  for (const entry of restored) {
    const target = store(entry.mapId), layer = target.document.getLayer(entry.layerId);
    if (!layer || !isEntityLayer(layer)) refuse("INTERNAL_ERROR", "A journaled entity layer is unavailable");
    const order=rankFor(entry.mapId,entry.layerId),rank=order.get(entry.id)??Infinity;
    const next=layer.entities.findIndex(entity=>(order.get(entity.id)??Infinity)>rank);
    target.dispatch({ type: "addEntity", layerId: entry.layerId, entity: { ...entry.before, fields:entry.before.fields }, index:next<0?layer.entities.length:next });
  }
}
