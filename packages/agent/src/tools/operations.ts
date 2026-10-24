import { LEVEL_FORMAT, MapStore, entityProblem, isEntityLayer, isGridLayer, parseLevel, portalTarget, portalTargetPoint, resolveEntityFields, type Entity, type LayerPatch, type Op } from "@smap/core";
import { AGENT_LIMITS as L, AgentError, AgentErrorCode as E, type AgentCallContext, type ApplyOperationsArgs, type BatchOperation, type ChangeSummary, type EditEntityArgs, type EntityInfo, type ToolData } from "../contracts";
import { utf8ByteLength } from "../tags";
import { type Transactions, waitFor } from "../transactions";
import { budget, check, point } from "../validation";
import { change, mutate, protect } from "./mutations";

const entityInfo = (entity: Entity, layerId: string): EntityInfo => ({
  id: entity.id, typeId: entity.typeId, layerId, pixelX: entity.x, pixelY: entity.y, fields: { ...entity.fields },
});

export async function editEntity(tx: Transactions, a: EditEntityArgs, call: AgentCallContext): Promise<ToolData["edit_entity"]> {
  const store = tx.store(a.mapId), found = store.document.findEntity(a.entityId);
  check(found, E.UNKNOWN_ID, "Unknown entity");
  protect(tx, a.mapId, found.layer);
  let next = found.entity;
  if (a.action === "move") {
    point(store, a.at);
    next = { ...next, x: a.at.x * store.document.map.tileWidth, y: a.at.y * store.document.map.tileHeight };
  } else if (a.action === "update") next = { ...next, fields: { ...next.fields, ...a.fields } };
  if (a.action !== "remove") {
    const type = store.document.getEntityType(next.typeId);
    check(type, E.ENTITY_SCHEMA, "Unknown entity type");
    const problem = entityProblem(next, store.document.map, type);
    check(!problem, E.ENTITY_SCHEMA, problem ?? "Invalid entity");
    for (const field of resolveEntityFields(next, type))
      if (field.type === "levelRef" && field.value !== null)
        check(tx.host.world.maps().some(map => map.id === field.value), E.ENTITY_SCHEMA, "Unknown target map");
    const targetId = portalTarget(next), targetPoint = portalTargetPoint(next);
    if (targetId && targetPoint) {
      const target = await waitFor(tx.host.loadMap(targetId), call.signal);
      tx.owned(a.context, call);
      check(targetPoint.x >= 0 && targetPoint.y >= 0 &&
        targetPoint.x < target.document.map.width * target.document.map.tileWidth &&
        targetPoint.y < target.document.map.height * target.document.map.tileHeight,
      E.ENTITY_SCHEMA, "Portal target point outside target map");
    }
  }
  tx.authorizeEntity(a.mapId,found.layer.id,found.entity,a.action==="remove"?null:next);
  const retained = 512 + utf8ByteLength(JSON.stringify(found.entity)) * 2 + (a.action === "remove" ? 0 : utf8ByteLength(JSON.stringify(next)) * 2);
  tx.charge(0, retained);
  tx.run(() => {
    if (a.action === "remove") store.dispatch({ type: "removeEntity", entityId: a.entityId });
    else if (a.action === "move") store.dispatch({ type: "moveEntity", entityId: a.entityId, x: next.x, y: next.y });
    else store.dispatch({ type: "updateEntity", entityId: a.entityId, fields: a.fields });
  });
  const result = change(a.mapId, store);
  tx.record(result, retained);
  return { change: result, action: a.action, entityId: a.entityId, entity: a.action === "remove" ? null : entityInfo(next, found.layer.id) };
}

/** Only these operations can be projected without reading old tile/grid cells.
 * Existing palette/layer identities and ALL entities are retained so sequential
 * spawn/schema/mapping and cumulative resource checks use production code. */
function projection(store: MapStore): { store: MapStore; bytes: number } {
  const doc = store.document;
  const json = JSON.stringify({
    format: LEVEL_FORMAT, documentFormatVersion: doc.documentFormatVersion, map: doc.map, seed: doc.seed,
    palette: doc.palette.entries().map((entry, index) => ({ index: index + 1, ...entry })),
    layers: doc.layers.map(layer => ({
      id: layer.id, name: layer.name, type: layer.type, visible: layer.visible, locked: layer.locked, opacity: layer.opacity,
      ...(isGridLayer(layer) ? { role: layer.role } : {}),
      ...(isEntityLayer(layer) ? { entities: layer.entities.map(entity => ({ ...entity, fields: Object.keys(entity.fields).sort().map(name => ({ name, value: entity.fields[name] })) })) } : { chunks: [] }),
    })),
  });
  const bytes = utf8ByteLength(json) * 4;
  budget(bytes, L.retainedBytes);
  return { store: new MapStore(parseLevel(json, doc.tilesets, doc.entityTypes)), bytes };
}

async function applyItem(tx: Transactions, operation: BatchOperation, context: ApplyOperationsArgs["context"], call: AgentCallContext): Promise<{ change: ChangeSummary; entity?: EntityInfo | null; entityId?: string }> {
  const {expectedRevision:_revision,expectedMemberRevision:_member,...identity}=context;
  const args = { ...operation.args, context: { ...identity,...(context.expectedMemberRevision!==undefined?{expectedMemberRevision:context.expectedMemberRevision}:{expectedRevision:tx.revision}) } };
  if (operation.tool === "edit_entity") return editEntity(tx, args as EditEntityArgs, call);
  return await mutate(tx, operation.tool, args as never, call) as { change: ChangeSummary; entity?: EntityInfo };
}

export async function applyOperations(tx: Transactions, a: ApplyOperationsArgs, call: AgentCallContext): Promise<ToolData["apply_operations"]> {
  const stores = new Map<string, MapStore>();
  type Command = { mapId: string; op: Op };
  type SpatialPlan={cells:{mapId:string;layerId:string;points:{x:number;y:number}[]}[];entities:{mapId:string;layerId:string;before:Entity|null;after:Entity|null}[]};
  let spatial:SpatialPlan={cells:[],entities:[]};
  type Step = { spatial:SpatialPlan; tool: BatchOperation["tool"]; mapId: string; commands: Command[]; planned: number; retained: number; createdEntityIds: string[]; entityId?: string };
  const steps: Step[] = [];
  let commands: Command[] = [];
  let projectionBytes = 0;
  const existingIds = new Set<string>();
  for (const op of a.operations) {
    check(op.tool !== "place_stamp" || (!!op.args.layerMapping && !op.args.allowCreateLayers), E.INVALID_ARGUMENT,
      "Batch stamps require an explicit existing layer mapping");
    if (stores.has(op.args.mapId)) continue;
    let projected: ReturnType<typeof projection>;
    try { projected = projection(tx.store(op.args.mapId)); }
    catch (error) {
      if (error instanceof AgentError) throw error;
      throw new AgentError(E.INVALID_ARGUMENT, "Batch validation projection failed");
    }
    projectionBytes += projected.bytes;
    budget(projectionBytes + tx.pending!.summary.counters.retainedBytes, L.retainedBytes);
    stores.set(op.args.mapId, projected.store);
    const dispatch = projected.store.dispatch.bind(projected.store);
    projected.store.dispatch = ((coreOp: Op) => {
      commands.push({ mapId: op.args.mapId, op: coreOp });
      return dispatch(coreOp);
    }) as typeof projected.store.dispatch;
    for (const layer of projected.store.document.entityLayers()) for (const entity of layer.entities) existingIds.add(entity.id);
  }
  let id = 0;
  const shadow = Object.create(tx) as Transactions;
  Object.assign(shadow, {
    host: { ...tx.host, ids: { next: () => { let candidate: string; do candidate = `batch-validation-${++id}`.padEnd(128, "x"); while (existingIds.has(candidate)); existingIds.add(candidate); return candidate; } } },
    pending: { ...tx.pending!, summary: { ...tx.pending!.summary, counters: { ...tx.pending!.summary.counters } } },
    store: (mapId: string) => stores.get(mapId)!,
    planning:true,
    authorizeCells:(mapId:string,layerId:string,points:{x:number;y:number}[])=>{tx.pending!.collaboration?.assertCells(tx.memberCall!.journal.memberId,mapId,layerId,points);spatial.cells.push({mapId,layerId,points:[...points]});},
    authorizeEntity:(mapId:string,layerId:string,before:Entity|null,after:Entity|null)=>{const c=tx.pending!.collaboration,m=tx.memberCall?.journal.memberId;if(c&&m){if(before)c.assertEntity(m,mapId,layerId,before);if(after)c.assertEntity(m,mapId,layerId,after);}spatial.entities.push({mapId,layerId,before,after});},
    run: <T>(apply: () => T) => apply(), emit: () => {}, owned: tx.owned.bind(tx),
  });
  const initialPlanned = shadow.pending!.summary.counters.plannedWrites;
  let operationIndex = 0;
  // No live operation or ID allocation occurs until every child succeeds.
  try {
    for (const op of a.operations) {
      call.signal.throwIfAborted();
      commands = [];spatial={cells:[],entities:[]};
      const counters = shadow.pending!.summary.counters, beforeRetained = counters.retainedBytes;
      const result = await applyItem(shadow, op, a.context, call);
      const entityId = result.entity?.id ?? result.entityId;
      steps.push({ spatial, tool: op.tool, mapId: op.args.mapId, commands, planned: result.change.plannedCells,
        retained: counters.retainedBytes - beforeRetained, createdEntityIds: result.change.createdEntityIds,
        ...(entityId ? { entityId } : {}) });
      budget(shadow.pending!.summary.counters.plannedWrites - initialPlanned);
      budget(projectionBytes + shadow.pending!.summary.counters.retainedBytes, L.retainedBytes);
      operationIndex++;
    }
  } catch (error) {
    // Nothing was applied; name the failing child so the agent fixes only that item.
    const tool = a.operations[operationIndex]?.tool;
    if (error instanceof AgentError && (error.code === E.CANCELLED || error.code === E.TIMEOUT)) throw error;
    if (error instanceof AgentError)
      throw new AgentError(error.code, `operations[${operationIndex}] (${tool}): ${error.message}`, { ...error.details, operationIndex, ...(tool ? { tool } : {}) }, error.retryable);
    throw new AgentError(E.INVALID_ARGUMENT, `operations[${operationIndex}] (${tool}): batch preflight failed`, { operationIndex, ...(tool ? { tool } : {}) });
  }
  tx.owned(a.context, call);
  const changes: ChangeSummary[] = [], items: ToolData["apply_operations"]["items"] = [];
  // Reserve final IDs before applying. Preflight uses maximum-length valid IDs,
  // so its retained-memory estimate is conservative for the real host IDs.
  const ids = new Map<string, string>();
  for (const step of steps) for (const id of step.createdEntityIds) {
    const actual = tx.host.ids.next("entity");
    check(actual.length > 0 && actual.length <= 128 && !existingIds.has(actual), E.INVALID_ARGUMENT, "Entity allocator returned a duplicate or invalid ID");
    existingIds.add(actual); ids.set(id, actual);
  }
  for(const step of steps){for(const plan of step.spatial.cells)tx.authorizeCells(plan.mapId,plan.layerId,plan.points);for(const plan of step.spatial.entities){const resolve=(entity:Entity|null)=>entity?{...entity,id:ids.get(entity.id)??entity.id}:null;tx.authorizeEntity(plan.mapId,plan.layerId,resolve(plan.before),resolve(plan.after));}}
  tx.reserveMemberCall(projectionBytes+steps.reduce((sum,step)=>sum+step.retained,0));
  // Replay only the already validated core commands. No loading, asynchronous
  // validation or event-loop yield can expose a partially applied batch.
  tx.run(() => {
    for (const step of steps) {
      const patches: LayerPatch[] = [];
      for (const command of step.commands) {
        let op = command.op;
        if (op.type === "addEntity" && op.entity.id && ids.has(op.entity.id))
          op = { ...op, entity: { ...op.entity, id: ids.get(op.entity.id)! } };
        else if ((op.type === "removeEntity" || op.type === "moveEntity" || op.type === "updateEntity") && ids.has(op.entityId))
          op = { ...op, entityId: ids.get(op.entityId)! };
        const store = tx.store(command.mapId);
        if (op.type === "paintCells" || op.type === "paintGrid") patches.push(store.dispatch(op));
        else store.dispatch(op);
      }
      const result = change(step.mapId, tx.store(step.mapId), step.planned, patches, [], step.createdEntityIds.map(id => ids.get(id)!));
      tx.record(result, step.retained); changes.push(result);
      const entityId = step.entityId ? ids.get(step.entityId) ?? step.entityId : undefined;
      items.push({ tool: step.tool, changedCells: result.changedCells, ...(entityId ? { entityId } : {}) });
    }
  });
  return { items, change: {
    plannedCells: changes.reduce((sum, c) => sum + c.plannedCells, 0),
    changedCells: changes.reduce((sum, c) => sum + c.changedCells, 0),
    affected: changes.flatMap(c => c.affected).map(affected => ({ ...affected, mapRevision: tx.store(affected.mapId).revision })),
    createdLayerIds: [], createdEntityIds: changes.flatMap(c => c.createdEntityIds),
  } };
}
