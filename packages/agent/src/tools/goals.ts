import { cellFlags, cellPaletteIndex, isEntityLayer, isGridLayer, type Entity, type MapStore } from "@smap/core";
import { AGENT_LIMITS as L, AgentErrorCode as E, type AgentCallContext, type GoalResult, type Point, type Rect, type ToolArguments, type ToolData } from "../contracts";
import { hashCanonical, utf8ByteLength } from "../tags";
import { type Transactions, waitFor } from "../transactions";
import { budget, check, point, rect } from "../validation";
import { compactFlags, layer } from "./mutations";

const within = (p: Point, r: Rect) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;
const entityWithin = (entity: Entity, region: Rect, store: MapStore) => within({
  x: entity.x / store.document.map.tileWidth, y: entity.y / store.document.map.tileHeight,
}, region);

export async function validateGoals(tx: Transactions, a: ToolArguments["validate_goals"], call: AgentCallContext): Promise<ToolData["validate_goals"]> {
  check(tx.host.world.maps().some(map => map.id === a.mapId), E.UNKNOWN_ID, "Unknown map");
  const store = await waitFor(tx.host.loadMap(a.mapId), call.signal);
  tx.enlist(a.mapId, store);
  const results: GoalResult[] = [];
  let scannedCells = 0, entityVisits = 0, digestBytes = 0;
  for (const goal of a.checks) {
    call.signal.throwIfAborted();
    rect(store, goal.region);
    const area = goal.region.width * goal.region.height;
    budget(area, L.readCellsPerLayer);
    const ids = goal.kind === "reachability" ? goal.collisionLayerIds : goal.layerIds;
    budget(ids.length, L.readLayers);
    check(new Set(ids).size === ids.length, E.INVALID_ARGUMENT, "Select unique goal layers");
    for (const id of ids) layer(store, id);
    const layers = store.document.layers.filter(target => ids.includes(target.id));
    scannedCells += area * layers.length;
    budget(scannedCells, L.readCellsTotal);
    if (goal.kind === "reachability") {
      for (const target of layers) check(isGridLayer(target) && target.role === "collision", E.LAYER_KIND, "Reachability requires explicit collision layers");
      point(store, goal.from); point(store, goal.to);
      check(within(goal.from, goal.region) && within(goal.to, goal.region), E.OUT_OF_BOUNDS, "Reachability endpoints must be inside the search region");
      const passable = (x: number, y: number) => {
        let decision = 0;
        // Same manual rule as the editor: uppermost nonempty collision wins.
        for (const target of layers) { const value = target.getCell(x, y); if (value) decision = value; }
        return decision === 0 ? !goal.emptyIsBlocked : !goal.blockedValues.includes(decision as 1 | 2);
      };
      let reached = false, visited = 0;
      if (passable(goal.from.x, goal.from.y) && passable(goal.to.x, goal.to.y)) {
        const seen = new Uint8Array(area), queue: Point[] = [goal.from];
        const index = (p: Point) => (p.y - goal.region.y) * goal.region.width + p.x - goal.region.x;
        seen[index(goal.from)] = 1;
        for (let head = 0; head < queue.length; head++) {
          const p = queue[head]!; visited++;
          if (p.x === goal.to.x && p.y === goal.to.y) { reached = true; break; }
          for (const d of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
            const q = { x: p.x + d.x, y: p.y + d.y };
            if (within(q, goal.region) && !seen[index(q)] && passable(q.x, q.y)) { seen[index(q)] = 1; queue.push(q); }
          }
        }
      }
      results.push({ kind: goal.kind, passed: reached, detail: reached ? "Endpoints are connected under the explicit collision rule" : "Endpoints are disconnected or blocked under the explicit collision rule", visitedCells: visited });
    } else if (goal.kind === "entity_count") {
      check(goal.min <= goal.max, E.INVALID_ARGUMENT, "Entity count min must not exceed max");
      if (goal.typeId !== undefined) check(store.document.getEntityType(goal.typeId), E.UNKNOWN_ID, "Unknown entity type");
      let count = 0;
      for (const target of layers) {
        check(isEntityLayer(target), E.LAYER_KIND, "Entity counts require entity layers");
        entityVisits += target.entities.length; budget(entityVisits, L.readCellsTotal);
        count += target.entities.filter(entity => entityWithin(entity, goal.region, store) && (goal.typeId === undefined || entity.typeId === goal.typeId)).length;
      }
      results.push({ kind: goal.kind, passed: count >= goal.min && count <= goal.max, count, detail: `Found ${count} entities; expected ${goal.min}–${goal.max}` });
    } else {
      const content = layers.map(target => {
        if (isEntityLayer(target)) {
          entityVisits += target.entities.length; budget(entityVisits, L.readCellsTotal);
          const entities = target.entities.filter(entity => entityWithin(entity, goal.region, store));
          budget(entities.length, L.entitiesPerRead);
          return { id: target.id, kind: "entity", visible: target.visible, opacity: target.opacity, entities: [...entities].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
        }
        const cells: unknown[] = [];
        for (let y = goal.region.y; y < goal.region.y + goal.region.height; y++)
          for (let x = goal.region.x; x < goal.region.x + goal.region.width; x++) {
            const cell = target.getCell(x, y);
            if (isGridLayer(target) || !cell) cells.push(cell);
            else {
              const tile = store.document.palette.get(cellPaletteIndex(cell));
              check(tile, E.UNKNOWN_ID, "Cell references missing palette");
              cells.push({ ...tile, flags: compactFlags(cellFlags(cell)) });
            }
          }
        return isGridLayer(target)
          ? { id: target.id, kind: "collision", cells }
          : { id: target.id, kind: "tile", visible: target.visible, opacity: target.opacity, cells };
      });
      const payload = ["goal-region-v2", a.mapId, goal.region, { tileWidth: store.document.map.tileWidth, tileHeight: store.document.map.tileHeight }, content];
      digestBytes += utf8ByteLength(JSON.stringify(payload)); budget(digestBytes, L.requestBytes);
      const digest = hashCanonical(payload), passed = goal.expectedDigest === undefined ? null : digest === goal.expectedDigest;
      results.push({ kind: goal.kind, passed, digest, detail: passed === null ? "Baseline captured; supply expectedDigest after editing" : passed ? "Region content matches the baseline" : "Region content differs from the baseline" });
    }
  }
  return { valid: results.some(result => result.passed === false) ? false : results.some(result => result.passed === null) ? null : true, checks: results, scannedCells };
}
