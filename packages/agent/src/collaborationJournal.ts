/** Per-call recovery and per-member inverse journals inside one shared core transaction. */
import { isEntityLayer, type Entity, type MapStore } from "@smap/core";
import { AGENT_LIMITS, AgentError, AgentErrorCode, type Id, type Point } from "./contracts";
import { cellJournalKey, entityJournalKey, type RegionCollaboration, restoreSpatialJournal, spatialJournal, type JournalCell, type JournalEntity, type SpatialJournal } from "./collaboration";
interface CellTarget extends Point { mapId: Id; layerId: Id }
interface EntityTarget { mapId: Id; layerId: Id; id: Id }
export interface CollaborativeCall {
  memberId: Id; cells: Map<string, CellTarget>; entities: Map<string, EntityTarget>;
  before: SpatialJournal; addedCells: string[]; addedEntities: string[]; spawns: Set<Id>;
  addedBytes: number; applied: boolean; newSpawns: Id[]; newOrders: Map<string,number>; entityOrder:Map<string,readonly Id[]>;
}
const freshCall = (memberId: Id): CollaborativeCall => ({ memberId, cells: new Map(), entities: new Map(), before: spatialJournal(), addedCells: [], addedEntities: [], spawns: new Set(), addedBytes: 0, applied: false, newSpawns: [], newOrders:new Map(), entityOrder:new Map() });

export class CollaborationJournal {
  private readonly journals = new Map<Id, SpatialJournal>();
  private readonly entityOrder = new Map<string, readonly Id[]>();
  private orderBytes = 0;
  constructor(private readonly collaboration: RegionCollaboration, private readonly store: (mapId: Id) => MapStore) {}
  begin(memberId: Id): CollaborativeCall { return freshCall(memberId); }
  cells(call: CollaborativeCall, mapId: Id, layerId: Id, points: readonly Point[]): void {
    this.collaboration.assertCells(call.memberId, mapId, layerId, points);
    for (const point of points) call.cells.set(cellJournalKey(mapId, layerId, point), { mapId, layerId, x: point.x, y: point.y });
    // A call may cover as much as the tool's own cap allows (paint_grid, uniform ops, replace_tiles);
    // the draft-wide planned-cell and retained-memory budgets still bound the journal.
    if (call.cells.size > AGENT_LIMITS.transactionPlannedWrites) throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED, "Combined spatial footprint exceeds the per-call journal budget");
  }
  entity(call: CollaborativeCall, mapId: Id, layerId: Id, before: Entity | null, after: Entity | null): void {
    if (before) this.collaboration.assertEntity(call.memberId, mapId, layerId, before);
    if (after) this.collaboration.assertEntity(call.memberId, mapId, layerId, after);
    const id = before?.id ?? after?.id;
    if (!id) throw new AgentError(AgentErrorCode.INVALID_ARGUMENT, "Entity journal needs an existing or allocated ID");
    call.entities.set(entityJournalKey(mapId, id), { mapId, layerId, id });
    if (before?.typeId === "spawn" || after?.typeId === "spawn") call.spawns.add(mapId);
    if (call.entities.size > 256) throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED, "Entity journal exceeds the per-call budget");
  }
  /** Called immediately before the first live command, with all footprints preflighted. */
  capture(call: CollaborativeCall, reserve: (retainedBytes: number) => void): void {
    const member = this.journals.get(call.memberId) ?? spatialJournal();
    const newCells = [...call.cells].filter(([key]) => !call.before.cells.has(key));
    const newEntities = [...call.entities].filter(([key]) => !call.before.entities.has(key));
    let retained = newCells.length * 224, newOrderBytes = 0;
    const orders = new Map<string, readonly Id[]>();
    const callOrders = new Map<string, readonly Id[]>();
    const entities = new Map<string, JournalEntity>();
    for (const [key, target] of newEntities) {
      const doc = this.store(target.mapId).document, found = doc.findEntity(target.id), layer = doc.getLayer(target.layerId);
      if (!layer || !isEntityLayer(layer)) throw new AgentError(AgentErrorCode.INTERNAL_ERROR, "Entity journal layer is unavailable");
      const before = found?.entity ?? null;
      entities.set(key, { ...target, before }); retained += 512 + (before ? JSON.stringify(before).length * 8 : 0);
      const orderKey = JSON.stringify([target.mapId, target.layerId]);
      if (!call.entityOrder.has(orderKey) && !callOrders.has(orderKey)) {
        const bytes = layer.entities.reduce((sum, entity) => sum + entity.id.length * 2 + 16, 0);
        if (this.orderBytes + newOrderBytes + bytes + retained > AGENT_LIMITS.retainedBytes) throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED, "Entity order journal exceeds the memory budget");
        retained+=bytes;
        const order=layer.entities.map(entity=>entity.id);callOrders.set(orderKey,order);
        if(!this.entityOrder.has(orderKey)){newOrderBytes+=bytes;orders.set(orderKey,order);}
      }
    }
    reserve(retained + newOrderBytes);
    for (const [key, target] of newCells) {
      const layer = this.store(target.mapId).document.getLayer(target.layerId);
      if (!layer || isEntityLayer(layer)) throw new AgentError(AgentErrorCode.INTERNAL_ERROR, "Cell journal layer is unavailable");
      const entry: JournalCell = { ...target, before: layer.getCell(target.x, target.y) };
      call.before.cells.set(key, entry);
      if (!member.cells.has(key)) { member.cells.set(key, entry); call.addedCells.push(key); call.addedBytes += 112; }
    }
    for (const [key, entry] of entities) {
      call.before.entities.set(key, entry);
      if (!member.entities.has(key)) { member.entities.set(key, entry); call.addedEntities.push(key); call.addedBytes += 256 + (entry.before ? JSON.stringify(entry.before).length * 4 : 0); }
    }
    for(const[key,order]of callOrders)call.entityOrder.set(key,order);
    for (const [key, order] of orders) {this.entityOrder.set(key, order);call.newOrders.set(key,order.reduce((sum,id)=>sum+id.length*2+16,0));}
    this.orderBytes += newOrderBytes; call.addedBytes += newOrderBytes;
    for (const mapId of call.spawns) if(this.collaboration.claimSpawn(call.memberId, mapId))call.newSpawns.push(mapId);
    this.journals.set(call.memberId, member); call.applied = true;
  }
  recover(call: CollaborativeCall): void {
    restoreSpatialJournal(call.before, this.store, call.entityOrder);
    for(const mapId of call.newSpawns)this.collaboration.releaseSpawn(call.memberId,mapId);
    for(const[key,bytes]of call.newOrders){this.entityOrder.delete(key);this.orderBytes-=bytes;}
    const member = this.journals.get(call.memberId);
    if (member) {
      for (const key of call.addedCells) member.cells.delete(key);
      for (const key of call.addedEntities) member.entities.delete(key);
    }
  }
  cancel(memberId: Id): void {
    const journal = this.journals.get(memberId);
    if (journal) restoreSpatialJournal(journal, this.store, this.entityOrder);
    this.journals.delete(memberId);
  }
}
