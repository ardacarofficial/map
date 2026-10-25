/** import_tiled (v2.2): a Tiled map becomes a new provisional map of the edit; its PNGs become world tilesets. */
import { makeCell, type LayerPatch, type PaletteEntry } from "@smap/core";
import { AGENT_LIMITS as L, AgentErrorCode as E, type AgentCallContext, type ToolArguments, type ToolData } from "../contracts";
import { type Transactions, waitFor } from "../transactions";
import { budget, check, dimensions } from "../validation";
import { change, createAgentMap, layerInfo } from "./mutations";

export const TILED_MAP_PATH = /\.(?:tmx|tmj|json)$/i;

export async function importTiled(tx: Transactions, a: ToolArguments["import_tiled"], call: AgentCallContext): Promise<ToolData["import_tiled"]> {
  const port = tx.host.tiled;
  check(port, E.EDITOR_UNAVAILABLE, "This editor cannot read local Tiled files", { nextAction: "Ask the user to use Dosya → İçe aktar → Tiled haritası… in the editor." });
  check(TILED_MAP_PATH.test(a.path), E.INVALID_ARGUMENT, "Only .tmx, .tmj and .json Tiled maps can be imported", { cause: "unsupportedType" });
  check(/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(a.path), E.INVALID_ARGUMENT, "path must be absolute", { cause: "relativePath" });
  budget(tx.pending!.summary.affectedMapIds.length + 1, L.targetMaps);
  tx.charge(0);
  const prepared = await waitFor(port.prepare({ path: a.path, transactionId: tx.pending!.summary.id }, call).then(p => {
    try { call.signal.throwIfAborted(); return p; } catch (error) { port.discard(p); throw error; }
  }), call.signal);
  let published = false;
  try {
    tx.owned(a.context, call);
    dimensions(prepared.width, prepared.height);
    budget(prepared.layers.length, L.layersPerMap);
    const planned = prepared.layers.reduce((n, l) => n + l.cells.length, 0);
    const retained = prepared.retainedBytes + planned * 32;
    tx.charge(planned, retained, L.fillCells);
    // Every loaded map carries world tilesets; join them so the additions roll back with the draft.
    await tx.enlistCached(call);
    const created = await createAgentMap(tx, {
      context: a.context, name: (a.name ?? prepared.name).trim() || prepared.name,
      width: prepared.width, height: prepared.height, tileWidth: prepared.tileWidth, tileHeight: prepared.tileHeight,
      ...(a.world ? { world: a.world } : {}),
    }, call, prepared.layers.map(l => ({ name: l.name.slice(0, L.layerNameLength) || "Layer", visible: l.visible, opacity: l.opacity })));
    const store = created.store, mapId = created.data.map.id;
    const layerIds = store.document.layers.map(l => l.id);
    const patches = tx.run(() => {
      for (const participant of tx.pending!.participants.values())
        for (const tileset of prepared.tilesets)
          if (!participant.store.document.getTileset(tileset.id))
            participant.store.dispatch({ type: "addTileset", tileset, undoable: true });
      port.publish(prepared);
      published = true;
      tx.pending!.imports.push(prepared);
      const keys = new Map<string, number>(), entries: PaletteEntry[] = [];
      for (const l of prepared.layers) for (const c of l.cells) {
        const key = `${c.tilesetId}\u0000${c.tileId}`;
        if (!keys.has(key)) { keys.set(key, entries.length); entries.push({ tilesetId: c.tilesetId, tileId: c.tileId }); }
      }
      const indices = store.dispatch({ type: "addPaletteEntries", entries });
      const out: LayerPatch[] = [];
      prepared.layers.forEach((l, i) => {
        const layerId = layerIds[i]!;
        if (l.cells.length) out.push(store.dispatch({ type: "paintCells", layerId, cells: l.cells.map(c => ({ x: c.x, y: c.y, cell: makeCell(indices[keys.get(`${c.tilesetId}\u0000${c.tileId}`)!]!, c.flags) })) }));
        // Locked layers ignore writes: lock after painting.
        if (l.locked) store.dispatch({ type: "setLayerProps", layerId, props: { locked: true } });
      });
      return out;
    });
    const result = change(mapId, store, planned, patches, layerIds);
    tx.record(result, retained);
    return {
      change: result, map: created.data.map,
      layers: store.document.layers.map(l => layerInfo(store, l)),
      tilesets: prepared.summary, unsupported: prepared.unsupported,
    };
  } catch (error) {
    if (!published) port.discard(prepared);
    throw error;
  }
}
