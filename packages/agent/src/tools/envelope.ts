/** C3: every map mutation answers with one compact envelope instead of its internal change summary. */
import type { ChangeSummary, EditBudget, Id, LayerInfo, Revision, ToolName, WriteEnvelope } from "../contracts";
import { compact } from "./grid";

/** Lifecycle and collaboration tools keep their own informative results. */
const LIFECYCLE = new Set<string>(["begin_edit", "resume_edit", "finish_edit", "cancel_edit", "join_edit"]);
export const compactWrite = (name: string): boolean => !LIFECYCLE.has(name);

type Raw = { change?: ChangeSummary; [key: string]: unknown };
const ids = (value: unknown): Id[] | undefined => Array.isArray(value) && value.length ? value as Id[] : undefined;

/** Ids the agent needs next; everything else stays internal (activity log, previews). */
function createdIds(name: ToolName, raw: Raw): Record<string, unknown> {
  switch (name) {
    case "create_map": case "import_tiled": {
      const map = raw.map as { id: Id } | undefined, layers = raw.layers as LayerInfo[] | undefined;
      return { ...(map ? { mapId: map.id } : {}), ...(layers?.length ? { layers: layers.map(l => ({ id: l.id, name: l.name, kind: l.kind })) } : {}) };
    }
    case "create_stamp": return { stampId: raw.stampId, ...(ids(raw.sourceLayerIds) ? { sourceLayerIds: raw.sourceLayerIds } : {}) };
    case "edit_stamp": return raw.action === "duplicate" ? { stampId: raw.stampId } : {};
    case "prepare_smart_source": case "smart_brush": case "draw_path": return typeof raw.sourceId === "string" ? { sourceId: raw.sourceId } : {};
    case "place_entity": return raw.entity ? { entityIds: [(raw.entity as { id: Id }).id] } : {};
    default: return {};
  }
}
/** Small tool-specific facts worth a few bytes. */
function extras(name: ToolName, raw: Raw): Record<string, unknown> {
  switch (name) {
    case "prepare_smart_source": return { band: raw.band, usages: raw.usages };
    case "apply_operations": return { items: (raw.items as { tool: string; changedCells: number; entityId?: Id }[]).map(i => ({ tool: i.tool, changed: i.changedCells, ...(i.entityId ? { entityId: i.entityId } : {}) })) };
    case "clear_region": return raw.removedEntities ? { removedEntities: raw.removedEntities } : {};
    case "resize_map": {
      const cropped = raw.cropped as { cells: number; entities: number } | undefined;
      return cropped && (cropped.cells || cropped.entities) ? { cropped } : {};
    }
    case "import_tiled": return { tilesets: raw.tilesets, unsupported: raw.unsupported };
    case "replace_tiles": return Array.isArray(raw.maps) && raw.maps.length > 1 ? { maps: raw.maps } : {};
    default: return {};
  }
}

export function writeEnvelope(name: ToolName, data: unknown, revision: Revision, budget: EditBudget | undefined, flags: { replayed?: boolean; transactionState?: string; memberId?: Id; memberRevision?: Revision } = {}): WriteEnvelope {
  const raw = (data ?? {}) as Raw;
  const base = raw.change ? compact(raw.change) : { changed: typeof raw.changed === "number" ? raw.changed : 0 };
  const warnings = [...new Set([...((raw.warnings as string[] | undefined) ?? []), ...(base.warnings ?? [])])];
  const created: Record<string, unknown> = { ...(base.created ?? {}), ...((raw.created as object | undefined) ?? {}), ...createdIds(name, raw) };
  if (created.layers) delete created.layerIds;
  const bounds = base.bounds ?? (raw.bounds as WriteEnvelope["bounds"]);
  return {
    ok: true,
    revision,
    changed: typeof raw.changed === "number" ? raw.changed : base.changed,
    ...(bounds ? { bounds } : {}),
    ...(Object.keys(created).length ? { created } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...extras(name, raw),
    ...(budget ? { budget } : {}),
    ...(flags.transactionState && flags.transactionState !== "running" ? { transactionState: flags.transactionState } : {}),
    ...(flags.replayed ? { replayed: true as const } : {}),
    ...(flags.memberId ? { memberId: flags.memberId, memberRevision: flags.memberRevision! } : {}),
  } as WriteEnvelope;
}
