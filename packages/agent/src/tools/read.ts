import {
  cellFlags,
  cellPaletteIndex,
  entityProblem,
  isEntityLayer,
  isGridLayer,
  isValidTileId,
  portalTarget,
  portalTargetPoint,
  resolveEntityFields,
  tileCount,
  tileRect,
  type MapStore,
  type MapInfo as CoreMapInfo,
  type Tileset,
} from "@smap/core";
import {
  AGENT_LIMITS as L,
  ESSENTIAL_LIMITS,
  AgentErrorCode as E,
  type AgentCallContext,
  type AgentImageResult,
  type Id,
  type ImageBlock,
  type ResolvedTile,
  type SmartCandidateInfo,
  type TagRecord,
  type TagTarget,
  type ToolArguments,
  type ToolName,
  type ValidationIssue,
} from "../contracts";
import { TOOL_CATALOGUE_HASH } from "../catalogue.generated";
import { canonicalJson } from "../toolSchemas";
import { hashCanonical, semanticMatches } from "../tags";
import { type Transactions, waitFor } from "../transactions";
import { budget, check, fail, rect } from "../validation";
import { compactFlags, layer, layerInfo, mapInfo } from "./mutations";
import { entitiesIn, readGrid } from "./grid";

interface Cursor {
  revision: number;
  world: string | null;
  filter: string;
  offset: number;
  invalid?: boolean;
  hostCursor?: string | undefined;
  hostItems?: TagRecord[];
  hostMore?: boolean;
}
const cursors = new WeakMap<Transactions, Map<Id, Cursor>>();
function cursor(
  tx: Transactions,
  id: string | undefined,
  filter: unknown,
): Cursor {
  if (!id)
    return {
      revision: tx.revision,
      world: tx.host.session().worldSessionId,
      filter: canonicalJson(filter),
      offset: 0,
    };
  const found = cursors.get(tx)?.get(id);
  check(
    found && found.filter === canonicalJson(filter),
    E.INVALID_ARGUMENT,
    "Invalid pagination cursor",
  );
  check(
    found.world === tx.host.session().worldSessionId &&
      found.revision === tx.revision,
    E.REVISION_CONFLICT,
    "Pagination cursor is stale",
  );
  return found;
}
function next(
  tx: Transactions,
  prior: Cursor,
  offset: number,
  invalid?: boolean,
): string {
  let map = cursors.get(tx);
  if (!map) {
    map = new Map();
    cursors.set(tx, map);
  }
  if (map.size >= 1024) map.delete(map.keys().next().value!);
  const id = tx.host.ids.next("cursor");
  map.set(id, {
    ...prior,
    offset,
    ...(invalid === undefined ? {} : { invalid }),
  });
  return id;
}
export interface ReadOutput {
  data: unknown;
  image?: AgentImageResult;
  png?: ImageBlock;
}
export async function storeFor(
  tx: Transactions,
  id: string,
  call: AgentCallContext,
): Promise<MapStore> {
  check(
    tx.host.world.maps().some((m) => m.id === id),
    E.UNKNOWN_ID,
    "Unknown map",
  );
  const store = await waitFor(tx.host.loadMap(id), call.signal);
  tx.enlist(id, store);
  return store;
}
function tag(tx: Transactions, target: TagTarget, current: string): TagRecord {
  const available = tx.host.tags.availability();
  const stored =
    available.state === "ready"
      ? target.kind === "tile"
        ? available.sidecar.tiles.find(
            (t) =>
              t.tilesetId === target.tilesetId && t.tileId === target.tileId,
          )
        : available.sidecar.stamps.find((t) => t.stampId === target.stampId)
      : undefined;
  return {
    target,
    tags: stored?.tags ?? [],
    note: stored?.note ?? "",
    status: !stored
      ? "missing"
      : stored.fingerprint === current
        ? "current"
        : "stale",
    currentFingerprint: current,
    ...(stored ? { storedFingerprint: stored.fingerprint } : {}),
  };
}
const catalogTileCount = (tileset: Tileset): number => tileset.edited?.nextTileId ?? tileCount(tileset);
interface TilesetSummary {
  source: string;
  fingerprints: string[];
  fingerprint: string;
  tagsKey: string;
  tagCounts: { current: number; stale: number; missing: number };
}
/** Detected smart rectangles of source tilesets; empty when the host cannot detect or artwork is missing. */
async function smartCandidates(tx: Transactions, tilesets: readonly Tileset[], call: AgentCallContext): Promise<SmartCandidateInfo[]> {
  const detect = tx.host.smartSources.candidates?.bind(tx.host.smartSources);
  if (!detect) return [];
  const out: SmartCandidateInfo[] = [];
  for (const ts of tilesets) {
    if (ts.generated || ts.edited) continue;
    call.signal.throwIfAborted();
    try { out.push(...await waitFor(detect(ts.id, call.signal), call.signal)); }
    catch (error) { if (call.signal.aborted) throw error; }
  }
  return out;
}
const tilesetSummaries = new WeakMap<Transactions, Map<string, TilesetSummary>>();
export async function read<N extends ToolName>(
  tx: Transactions,
  name: N,
  args: ToolArguments[N],
  call: AgentCallContext,
): Promise<ReadOutput> {
  switch (name) {
    case "get_session": {
      const a = args as ToolArguments["get_session"],
        s = tx.host.session();
      const transaction = a.transactionId
        ? tx.pending?.summary.id === a.transactionId
          ? tx.pending.summary
          : (tx.terminals.get(a.transactionId)?.summary ?? null)
        : (tx.pending?.summary ?? tx.last);
      return {
        data: {
          currentClientSessionId:call.clientSessionId,
          apiVersion: 1,
          toolCatalogueHash: TOOL_CATALOGUE_HASH,
          world: s.world,
          maps: tx.host.world.maps(),
          activeMapId: s.activeMapId,
          activeLayerId: s.activeLayerId,
          clients: s.clients.map((client) => client.id === undefined ? client : { ...client, isSelf: call.clientSessionId.startsWith(client.id) }),
          transaction: tx.copy(transaction),
          limits: ESSENTIAL_LIMITS,
          references: tx.host.references?.list() ?? [],
          ...await (async () => {
            const smart = await smartCandidates(tx, tx.host.world.tilesets(), call);
            return smart.length ? { smart } : {};
          })(),
        },
      };
    }
    case "get_map_info": {
      const a = args as ToolArguments["get_map_info"],
        s = await storeFor(tx, a.mapId, call);
      return {
        data: {
          map: mapInfo(tx, a.mapId, s),
          layers: s.document.layers.map((l) => layerInfo(s, l)),
          entityCount: s.document
            .entityLayers()
            .reduce((n, l) => n + l.entities.length, 0),
          dirty: tx.host.world.maps().find((m) => m.id === a.mapId)!.dirty,
        },
      };
    }
    case "read_region": {
      const a = args as ToolArguments["read_region"],
        s = await storeFor(tx, a.mapId, call);
      const grid = readGrid(s, a);
      if ("format" in grid) return { data: grid };
      // format:"cells": the original flat legend-index arrays.
      const { region, targets } = grid;
      const legend: ResolvedTile[] = [],
        indices = new Map<string, number>();
      const entities = a.includeEntities ? entitiesIn(s, targets, region) : [];
      const layers = targets.map((target) => {
        const id = target.id;
        if (isEntityLayer(target)) return { id, kind: "entity" as const };
        const cells: number[] = [];
        for (let y = region.y; y < region.y + region.height; y++)
          for (let x = region.x; x < region.x + region.width; x++) {
            const cell = target.getCell(x, y);
            if (!cell || isGridLayer(target)) {
              cells.push(cell);
              continue;
            }
            const ref = s.document.palette.get(cellPaletteIndex(cell));
            check(ref, E.UNKNOWN_ID, "Cell references missing palette");
            const value = { ...ref, flags: compactFlags(cellFlags(cell)) },
              key = canonicalJson(value);
            if (!indices.has(key)) {
              legend.push(value);
              indices.set(key, legend.length);
            }
            cells.push(indices.get(key)!);
          }
        return {
          id,
          kind: isGridLayer(target)
            ? ("collision" as const)
            : ("tile" as const),
          cells,
        };
      });
      return { data: { region, legend, layers, entities } };
    }
    case "list_entity_types":
      return { data: { items: tx.host.world.entityTypes() } };
    case "list_tilesets": {
      const a = args as ToolArguments["list_tilesets"],
        c = cursor(tx, a.cursor, ["tilesets", a.limit, a.includeDetails !== false]),
        all = tx.host.world.tilesets(),
        selected = all.slice(c.offset, c.offset + (a.limit ?? 64)),
        items = [];
      for (const ts of selected) {
        const metadata = {
          id: ts.id,
          name: ts.name,
          tileWidth: ts.tileWidth,
          tileHeight: ts.tileHeight,
          columns: ts.columns,
          rows: ts.rows,
          margin: ts.margin,
          spacing: ts.spacing,
          tileCount: catalogTileCount(ts),
          kind: ts.edited ? "edited" : ts.generated ? "generated" : "source",
        };
        const smart = await smartCandidates(tx, [ts], call);
        if (smart.length) Object.assign(metadata, { smart });
        // First-pass discovery needs only project metadata, even when artwork
        // is unavailable. Detailed fingerprints remain an explicit full scan.
        if (a.includeDetails === false) { items.push(metadata); continue; }
        const sourceKey = tx.host.images.catalogSourceKey?.(ts.id);
        const source = canonicalJson([tx.host.session().worldSessionId, sourceKey,
          ts.tileWidth, ts.tileHeight, ts.columns, ts.rows, ts.margin, ts.spacing, ts.edited, catalogTileCount(ts)]);
        let cache = tilesetSummaries.get(tx);
        if (!cache) { cache = new Map(); tilesetSummaries.set(tx, cache); }
        let summary = sourceKey == null ? undefined : cache.get(ts.id);
        if (summary?.source !== source) summary = undefined;
        if (!summary) {
          const fingerprints: string[] = [];
          for (let tileId = 0; tileId < catalogTileCount(ts); tileId++) {
            call.signal.throwIfAborted();
            if (tileId % 128 === 0) check(tx.host.clock.now() < call.deadline, E.TIMEOUT, "Catalog deadline expired");
            fingerprints.push(await waitFor(tx.host.images.tileFingerprint(ts.id, tileId, call.signal), call.signal));
          }
          check(sourceKey == null || tx.host.images.catalogSourceKey?.(ts.id) === sourceKey,
            E.SOURCE_CHANGED, "Tileset changed while building catalog");
          summary = { source, fingerprints, fingerprint: hashCanonical(fingerprints), tagsKey: "", tagCounts: {current:0,stale:0,missing:0} };
          if (sourceKey != null && fingerprints.length * 160 <= L.retainedBytes) {
            const retained = () => [...cache.values()].reduce((bytes, entry) => bytes + entry.fingerprints.length * 160 + entry.tagsKey.length * 2, 0);
            while (cache.size && (cache.size >= 256 || retained() + fingerprints.length * 160 > L.retainedBytes)) cache.delete(cache.keys().next().value!);
            cache.set(ts.id, summary);
          }
        }
        const available = tx.host.tags.availability();
        const tagsKey = canonicalJson(available.state === "ready"
          ? available.sidecar.tiles.filter(record => record.tilesetId === ts.id)
          : available);
        if (summary.tagsKey !== tagsKey) {
          const records = new Map(available.state === "ready"
            ? available.sidecar.tiles.filter(record => record.tilesetId === ts.id).map(record => [record.tileId, record]) : []);
          summary.tagCounts = { current: 0, stale: 0, missing: 0 };
          for (let tileId = 0; tileId < summary.fingerprints.length; tileId++) {
            const record = records.get(tileId);
            summary.tagCounts[!record ? "missing" : record.fingerprint === summary.fingerprints[tileId] ? "current" : "stale"]++;
          }
          summary.tagsKey = tagsKey;
        }
        items.push({
          ...metadata,
          fingerprint: summary.fingerprint,
          tagCounts: { ...summary.tagCounts },
        });
      }
      return {
        data: {
          items,
          nextCursor:
            c.offset + selected.length < all.length
              ? next(tx, c, c.offset + selected.length)
              : null,
        },
      };
    }
    case "get_tile_catalog": {
      const a = args as ToolArguments["get_tile_catalog"],
        ts = tx.host.world.tilesets().find((t) => t.id === a.tilesetId);
      check(ts, E.UNKNOWN_ID, "Unknown tileset");
      check(
        !a.tileIds || (a.offset === undefined && a.limit === undefined),
        E.INVALID_ARGUMENT,
        "Use tileIds or offset/limit",
      );
      const imageMode = a.image ?? "tiles";
      check(
        !a.sheetRegion || imageMode === "sheet",
        E.INVALID_ARGUMENT,
        "sheetRegion requires sheet image mode",
      );
      check(imageMode !== "sheet" || !a.tileIds, E.INVALID_ARGUMENT, "Sheet mode uses sheetRegion, not tileIds");
      const region = a.sheetRegion ?? { x: 0, y: 0, width: ts.columns, height: ts.rows };
      if (imageMode === "sheet") check(
        region.x + region.width <= ts.columns && region.y + region.height <= ts.rows,
        E.OUT_OF_BOUNDS, "Sheet crop outside tileset");
      const limit = a.limit ?? 64, offset = a.offset ?? 0;
      const completeRows = Math.max(0, Math.min(region.height, Math.floor(catalogTileCount(ts) / ts.columns) - region.y));
      const partialRow = Math.floor(catalogTileCount(ts) / ts.columns);
      const partialCount = partialRow >= region.y && partialRow < region.y + region.height
        ? Math.max(0, Math.min(region.width, catalogTileCount(ts) % ts.columns - region.x)) : 0;
      const total = imageMode === "sheet" ? completeRows * region.width + partialCount : catalogTileCount(ts);
      check(offset < total || total === 0 && offset === 0, E.OUT_OF_BOUNDS, "Catalog offset outside tileset");
      const ids = a.tileIds ?? Array.from({ length: Math.min(limit, Math.max(0, total - offset)) }, (_, i) => {
        const index = offset + i;
        return imageMode === "sheet"
          ? (region.y + Math.floor(index / region.width)) * ts.columns + region.x + index % region.width
          : index;
      });
      budget(ids.length, imageMode === "tiles" ? L.catalogImagePage : L.catalogPage);
      for (const id of ids) check(isValidTileId(ts, id), E.UNKNOWN_ID, "Unknown tile");
      const items = [];
      for (const tileId of ids) {
        const fingerprint = await waitFor(
            tx.host.images.tileFingerprint(ts.id, tileId, call.signal),
            call.signal,
          ),
          record = tag(
            tx,
            { kind: "tile", tilesetId: ts.id, tileId },
            fingerprint,
          );
        items.push(a.details ? {
          tileId,
          sourceRect: tileRect(ts, tileId),
          tags: record.tags,
          note: record.note,
          tagStatus: record.status,
          fingerprint,
        } : {
          tileId,
          ...(record.tags.length ? { tags: record.tags } : {}),
          ...(record.note ? { note: record.note } : {}),
        });
      }
      const image =
        imageMode !== "none"
          ? await waitFor(
              tx.host.images.tileCatalog(
                { ...a, image: imageMode, scale: a.scale ?? 2 },
                call,
              ),
              call.signal,
            )
          : undefined;
      return {
        data: {
          tilesetId: ts.id,
          items,
          ...(image ? { image: a.details ? image.image : (({ placements: _placements, sheet, ...rest }) => ({ ...rest, ...(sheet ? { sheet: { region: sheet.region } } : {}) }))(image.image) } : {}),
          ...(!a.tileIds && offset + ids.length < total
            ? { nextOffset: offset + ids.length }
            : {}),
        },
        ...(image ? { image } : {}),
      };
    }
    case "list_stamps": {
      const a = args as ToolArguments["list_stamps"],
        c = cursor(tx, a.cursor, ["stamps", a.query, a.limit, a.query ? hashCanonical(tx.host.tags.availability()) : null]),
        all = [],
        prepared = new Map<string, { fingerprint: string; record: TagRecord }>();
      const availableTags = tx.host.tags.availability();
      const stampTags = new Map(availableTags.state === "ready"
        ? availableTags.sidecar.stamps.map(record => [record.stampId, record.tags]) : []);
      for (const stamp of tx.host.world.stamps()) {
        if (!a.query) { all.push(stamp); continue; }
        const metadata = [stamp.name, stamp.category ?? "", ...(stamp.tags ?? [])];
        // Name/category/manual tags need no pixel validation. Only the selected
        // page needs fingerprints unless a match depends on current AI tags.
        if (semanticMatches(a.query, metadata)) { all.push(stamp); continue; }
        if (!semanticMatches(a.query, [...metadata, ...(stampTags.get(stamp.id) ?? [])])) continue;
        const fingerprint = await waitFor(tx.host.images.stampFingerprint(stamp.id, call.signal), call.signal);
        const record = tag(tx, { kind: "stamp", stampId: stamp.id }, fingerprint);
        prepared.set(stamp.id, { fingerprint, record });
        if (semanticMatches(a.query, [...metadata, ...(record.status === "current" ? record.tags : [])])) all.push(stamp);
      }
      const selected = all.slice(c.offset, c.offset + (a.limit ?? 16)), items = [];
      for (const s of selected) {
        const fingerprint = prepared.get(s.id)?.fingerprint ?? await waitFor(
            tx.host.images.stampFingerprint(s.id, call.signal),
            call.signal,
          ),
          record = prepared.get(s.id)?.record ?? tag(tx, { kind: "stamp", stampId: s.id }, fingerprint);
        items.push({
          id: s.id,
          name: s.name,
          width: s.width,
          height: s.height,
          layers: s.layers.map((l) => ({
            sourceLayerId: l.layerId,
            name: l.name,
            kind: l.grid ? "collision" : "tile",
          })),
          category: s.category ?? "",
          tags: s.tags ?? [],
          semanticTags: record.status === "current" ? record.tags : [],
          smartUsages: s.nineSlice
            ? ["area", ...(s.nineSlice.road ? ["road"] : [])]
            : [],
          ...(s.nineSlice ? { smart: { kind: s.nineSlice.road ? "road" as const : "area" as const, band: s.nineSlice.border ?? 1 } } : {}),
          fingerprint,
        });
      }
      if (a.previewStampId)
        check(
          tx.host.world.stamps().some((s) => s.id === a.previewStampId),
          E.UNKNOWN_ID,
          "Unknown stamp",
        );
      check(!(a.previewStampId && a.includeSheet), E.INVALID_ARGUMENT, "Use previewStampId or includeSheet, not both");
      if (a.includeSheet) check(tx.host.images.stampSheet, E.EDITOR_UNAVAILABLE, "Stamp contact sheets are unavailable in this host");
      const sheet = a.includeSheet && items.length
        ? await waitFor(tx.host.images.stampSheet!(items.map(item => item.id), call), call.signal)
        : undefined;
      const image = a.previewStampId
        ? await waitFor(
            tx.host.images.stampPreview(a.previewStampId, call),
            call.signal,
          )
        : sheet;
      return {
        data: {
          items,
          nextCursor:
            c.offset + selected.length < all.length
              ? next(tx, c, c.offset + selected.length)
              : null,
          ...(image
            ? {
                image: {
                  width: image.width,
                  height: image.height,
                  ...(a.previewStampId ? { stampId: a.previewStampId } : {}),
                  ...(sheet ? { sheet: sheet.sheet } : {}),
                },
              }
            : {}),
        },
        ...(image ? { image } : {}),
      };
    }
    case "render_preview": {
      const a = args as ToolArguments["render_preview"],
        s = await storeFor(tx, a.mapId, call);
      if (a.region) rect(s, a.region);
      if (a.layerIds) for (const id of a.layerIds) layer(s, id);
      const image = await waitFor(
        tx.host.images.renderPreview(a, call),
        call.signal,
      );
      return {
        data: {
          mapId: a.mapId,
          region: image.region,
          mapRevision: image.mapRevision,
          image: image.image,
          warnings: image.warnings,
        },
        image,
      };
    }
    case "validate_map":
      return {
        data: await validateMap(
          tx,
          args as ToolArguments["validate_map"],
          call,
        ),
      };
    case "get_tags": {
      const a = args as ToolArguments["get_tags"];
      if (!a.query?.trim()) {
        const filter = () => ["tags", a.kind, a.tilesetId, a.status, a.limit, hashCanonical(tx.host.tags.availability())];
        const c = cursor(tx, a.cursor, filter());
        const { cursor: _cursor, ...hostArgs } = a;
        const page = await waitFor(tx.host.tags.get({ ...hostArgs, ...(c.hostCursor ? { cursor: c.hostCursor } : {}) }, call), call.signal);
        const nextCursor = page.nextCursor === null ? null : next(tx, {
          ...c, filter: canonicalJson(filter()), hostCursor: page.nextCursor,
        }, c.offset + page.items.length);
        return { data: { ...page, items: page.items.map(compactTag), nextCursor } };
      }
      const queryFilter = () => ["tags-query", a.kind, a.tilesetId, a.status, a.query, a.limit, hashCanonical(tx.host.tags.availability())];
      const c = cursor(tx, a.cursor, queryFilter());
      const items: TagRecord[] = [], limit = a.limit ?? 64;
      let hostCursor = c.hostCursor, more = c.hostMore ?? true, scanned = 0;
      const remainder = [...(c.hostItems ?? [])];
      while ((more || remainder.length) && items.length < limit && scanned < 4096) {
        call.signal.throwIfAborted();
        check(tx.host.clock.now() < call.deadline, E.TIMEOUT, "Semantic search deadline expired");
        if (!remainder.length) {
          const page = await waitFor(tx.host.tags.get({ context: a.context, query: a.query, ...(a.kind ? { kind: a.kind } : {}), ...(a.tilesetId ? { tilesetId: a.tilesetId } : {}), ...(hostCursor ? { cursor: hostCursor } : {}), status: "all", limit: L.tagsPage }, call), call.signal);
          remainder.push(...page.items);
          more = page.nextCursor !== null;
          hostCursor = page.nextCursor ?? undefined;
          // An adapter returning empty pages still consumes the bounded scan budget.
          if (!page.items.length) { scanned++; continue; }
        }
        const record = remainder.shift()!;
        scanned++;
        if ((a.status ?? "current") !== "all" && record.status !== (a.status ?? "current")) continue;
        const target = record.target;
        const stamp = target.kind === "stamp" ? tx.host.world.stamps().find(stamp => stamp.id === target.stampId) : undefined;
        if (semanticMatches(a.query, [...record.tags, record.note, ...(stamp ? [stamp.name, stamp.category ?? "", ...(stamp.tags ?? [])] : [])])) items.push(record);
      }
      const nextCursor = more || remainder.length ? next(tx, { ...c, filter: canonicalJson(queryFilter()), hostCursor, hostItems: remainder, hostMore: more }, c.offset + scanned) : null;
      return { data: { items: items.map(compactTag), nextCursor } };
    }
    default:
      fail(E.INVALID_ARGUMENT, "Unknown read tool");
  }
}
/** Tag listings omit empty words/notes and a stored fingerprint equal to the current one. */
function compactTag(record: TagRecord): TagRecord {
  const { tags, note, storedFingerprint, ...rest } = record;
  return { ...rest, ...(tags.length ? { tags } : {}), ...(note ? { note } : {}),
    ...(storedFingerprint !== undefined && storedFingerprint !== record.currentFingerprint ? { storedFingerprint } : {}) } as TagRecord;
}
async function validateMap(
  tx: Transactions,
  a: ToolArguments["validate_map"],
  call: AgentCallContext,
) {
  const store = await storeFor(tx, a.mapId, call);
  if (a.region) rect(store, a.region);
  // One call scans the whole map (or region): counts by code plus the first `limit` issues.
  const issues: ValidationIssue[] = [],
    limit = a.limit ?? 32,
    byCode: Record<string, number> = {};
  let issueCount = 0;
  const maps = new Map(tx.host.world.maps().map(map => [map.id, map]));
  type Dimensions = Pick<CoreMapInfo, "width" | "height" | "tileWidth" | "tileHeight">;
  const targets = new Map<string, Promise<Dimensions>>([[a.mapId, Promise.resolve(store.document.map)]]);
  const targetDimensions = (id: string): Promise<Dimensions> => {
    let dimensions = targets.get(id);
    if (!dimensions) {
      const map = maps.get(id)!;
      dimensions = map.width != null && map.height != null && map.tileWidth != null && map.tileHeight != null
        ? Promise.resolve({ width: map.width, height: map.height, tileWidth: map.tileWidth, tileHeight: map.tileHeight })
        : waitFor(tx.host.loadMap(id), call.signal).then(target => target.document.map);
      targets.set(id, dimensions);
    }
    return dimensions;
  };
  const add = (
    code: string,
    detail: string,
    extra: Partial<ValidationIssue> = {},
  ) => {
    issueCount++;
    byCode[code] = (byCode[code] ?? 0) + 1;
    if (issues.length < limit) issues.push({ severity: "error", code, detail, mapId: a.mapId, ...extra });
  };
  function* records(): Generator<() => void | Promise<void>> {
    // Sparse chunks keep whole-map validation independent of a map's empty area.
    for (const entry of store.document.palette.entries())
      yield () => {
        const ts = store.document.getTileset(entry.tilesetId);
        if (!ts || !isValidTileId(ts, entry.tileId))
          add(
            "INVALID_TILE_REFERENCE",
            "Palette references an unavailable tile",
          );
      };
    for (const l of store.document.layers) {
      if (isEntityLayer(l)) {
        for (const e of l.entities) {
          const type = store.document.getEntityType(e.typeId);
          yield () => {
            const problem = entityProblem(e, store.document.map, type);
            if (!type || problem)
              add("ENTITY_SCHEMA", problem ?? "Unknown entity type", {
                layerId: l.id,
                entityId: e.id,
              });
          };
          // Missing fields use the same current type defaults as game exports.
          // Each reference is its own record, so one entity cannot exceed the issue-page limit.
          for (const field of resolveEntityFields(e, type))
            if (field.type === "levelRef")
              yield () => {
                if (field.value !== null && !maps.has(field.value as string))
                  add("PORTAL_TARGET", "Unknown target map", {
                    layerId: l.id,
                    entityId: e.id,
                  });
              };
          const targetId = portalTarget(e), point = portalTargetPoint(e);
          if (targetId && point && maps.has(targetId))
            yield async () => {
              const target = await targetDimensions(targetId);
              if (point.x < 0 || point.y < 0 || point.x >= target.width * target.tileWidth || point.y >= target.height * target.tileHeight)
                add("PORTAL_TARGET", "Portal target point outside target map", { layerId: l.id, entityId: e.id });
            };
        }
      } else
        for (const chunk of l.chunks())
          for (let i = 0; i < chunk.data.length; i++) {
            const cell = chunk.data[i]!;
            if (!cell) continue;
            const x = chunk.cx * 32 + (i % 32),
              y = chunk.cy * 32 + Math.floor(i / 32);
            if (
              a.region &&
              (x < a.region.x ||
                y < a.region.y ||
                x >= a.region.x + a.region.width ||
                y >= a.region.y + a.region.height)
            )
              continue;
            yield () => {
              if (!store.document.inBounds(x, y))
                add("OUT_OF_BOUNDS", "Occupied cell outside map", {
                  layerId: l.id,
                  x,
                  y,
                });
              if (isGridLayer(l)) {
                if (l.role !== "collision" || cell > 2)
                  add("LAYER_KIND", "Invalid collision data", {
                    layerId: l.id,
                    x,
                    y,
                  });
              } else {
                const ref = store.document.palette.get(cellPaletteIndex(cell));
                if (!ref)
                  add("INVALID_PALETTE_REFERENCE", "Missing palette entry", {
                    layerId: l.id,
                    x,
                    y,
                  });
              }
            };
          }
    }
    for (const recipe of tx.host.metadata.snapshot().recipes)
      for (const ref of recipe.stamp.palette)
        yield () => {
          if (
            !tx.host.world
              .tilesets()
              .some(
                (t) => t.id === ref.tilesetId && isValidTileId(t, ref.tileId),
              )
          )
            add(
              "GENERATED_SOURCE_UNAVAILABLE",
              "Recipe source tile is unavailable",
            );
        };
  }
  let scannedCells = 0;
  for (const inspect of records()) {
    if (scannedCells % 1024 === 0) {
      call.signal.throwIfAborted();
      check(tx.host.clock.now() < call.deadline, E.TIMEOUT, "Validation deadline expired",
        { nextAction: "Validate a smaller region at a time." });
    }
    const inspection = inspect();
    if (inspection) await inspection;
    scannedCells++;
  }
  return {
    valid: issueCount === 0,
    issueCount,
    ...(issueCount ? { byCode } : {}),
    issues,
    ...(issueCount > issues.length ? { moreIssues: issueCount - issues.length } : {}),
    scannedCells,
  };
}
