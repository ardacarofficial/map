import {
  cellFlags,
  cellPaletteIndex,
  entityProblem,
  isEntityLayer,
  isGridLayer,
  isValidTileId,
  tileCount,
  tileRect,
  type MapStore,
  type Tileset,
} from "@smap/core";
import {
  AGENT_LIMITS as L,
  AgentErrorCode as E,
  type AgentCallContext,
  type AgentImageResult,
  type Id,
  type ImageBlock,
  type ResolvedTile,
  type EntityInfo,
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
async function storeFor(
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
          apiVersion: 1,
          toolCatalogueHash: TOOL_CATALOGUE_HASH,
          world: s.world,
          maps: tx.host.world.maps(),
          activeMapId: s.activeMapId,
          activeLayerId: s.activeLayerId,
          clients: s.clients,
          transaction: tx.copy(transaction),
          limits: L,
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
      rect(s, a.region);
      const area = a.region.width * a.region.height;
      budget(area, L.readCellsPerLayer);
      budget(area * a.layerIds.length, L.readCellsTotal);
      budget(a.layerIds.length, L.readLayers);
      const legend: ResolvedTile[] = [],
        indices = new Map<string, number>();
      const entities: EntityInfo[] = [];
      const layers = a.layerIds.map((id) => {
        const target = layer(s, id);
        if (isEntityLayer(target)) {
          if (a.includeEntities)
            for (const e of target.entities)
              if (
                e.x >= a.region.x * s.document.map.tileWidth &&
                e.y >= a.region.y * s.document.map.tileHeight &&
                e.x <
                  (a.region.x + a.region.width) * s.document.map.tileWidth &&
                e.y < (a.region.y + a.region.height) * s.document.map.tileHeight
              ) {
                budget(entities.length + 1, L.entitiesPerRead);
                entities.push({
                  id: e.id,
                  layerId: target.id,
                  typeId: e.typeId,
                  pixelX: e.x,
                  pixelY: e.y,
                  fields: { ...e.fields },
                });
              }
          return { id, kind: "entity" as const };
        }
        const cells: number[] = [];
        for (let y = a.region.y; y < a.region.y + a.region.height; y++)
          for (let x = a.region.x; x < a.region.x + a.region.width; x++) {
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
      return { data: { region: a.region, legend, layers, entities } };
    }
    case "list_entity_types":
      return { data: { items: tx.host.world.entityTypes() } };
    case "list_tilesets": {
      const a = args as ToolArguments["list_tilesets"],
        c = cursor(tx, a.cursor, ["tilesets", a.limit]),
        all = tx.host.world.tilesets(),
        selected = all.slice(c.offset, c.offset + (a.limit ?? 64)),
        items = [];
      for (const ts of selected) {
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
        items.push({
          tileId,
          sourceRect: tileRect(ts, tileId),
          tags: record.tags,
          note: record.note,
          tagStatus: record.status,
          fingerprint,
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
          ...(image ? { image: image.image } : {}),
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
        if (!semanticMatches(a.query, [stamp.name, stamp.category ?? "", ...(stamp.tags ?? []), ...(stampTags.get(stamp.id) ?? [])])) continue;
        const fingerprint = await waitFor(tx.host.images.stampFingerprint(stamp.id, call.signal), call.signal);
        const record = tag(tx, { kind: "stamp", stampId: stamp.id }, fingerprint);
        prepared.set(stamp.id, { fingerprint, record });
        if (semanticMatches(a.query, [stamp.name, stamp.category ?? "", ...(stamp.tags ?? []),
          ...(record.status === "current" ? record.tags : [])])) all.push(stamp);
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
          fingerprint,
        });
      }
      if (a.previewStampId)
        check(
          tx.host.world.stamps().some((s) => s.id === a.previewStampId),
          E.UNKNOWN_ID,
          "Unknown stamp",
        );
      const image = a.previewStampId
        ? await waitFor(
            tx.host.images.stampPreview(a.previewStampId, call),
            call.signal,
          )
        : undefined;
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
                  stampId: a.previewStampId,
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
      if (!a.query?.trim()) return { data: await waitFor(tx.host.tags.get(a, call), call.signal) };
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
      return { data: { items, nextCursor } };
    }
    default:
      fail(E.INVALID_ARGUMENT, "Unknown read tool");
  }
}
async function validateMap(
  tx: Transactions,
  a: ToolArguments["validate_map"],
  call: AgentCallContext,
) {
  const store = await storeFor(tx, a.mapId, call),
    c = cursor(tx, a.cursor, ["validate", a.mapId, a.region, a.limit]);
  if (a.region) rect(store, a.region);
  const issues: ValidationIssue[] = [],
    limit = a.limit ?? 128;
  const add = (
    code: string,
    detail: string,
    extra: Partial<ValidationIssue> = {},
  ) =>
    issues.push({ severity: "error", code, detail, mapId: a.mapId, ...extra });
  function* records(): Generator<() => void> {
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
      if (isEntityLayer(l))
        for (const e of l.entities)
          yield () => {
            const type = store.document.getEntityType(e.typeId),
              problem = entityProblem(e, store.document.map, type);
            if (!type || problem)
              add("ENTITY_SCHEMA", problem ?? "Unknown entity type", {
                layerId: l.id,
                entityId: e.id,
              });
            for (const def of type?.fields ?? [])
              if (
                def.type === "levelRef" &&
                e.fields[def.name] !== null &&
                !tx.host.world.maps().some((m) => m.id === e.fields[def.name])
              )
                add("PORTAL_TARGET", "Unknown target map", {
                  layerId: l.id,
                  entityId: e.id,
                });
          };
      else
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
  let offset = 0,
    scannedCells = 0,
    truncated = false;
  for (const inspect of records()) {
    if (offset % 1024 === 0) {
      call.signal.throwIfAborted();
      check(
        tx.host.clock.now() < call.deadline,
        E.TIMEOUT,
        "Validation deadline expired",
      );
    }
    if (offset < c.offset) {
      offset++;
      continue;
    }
    if (scannedCells >= 4096 || issues.length >= limit) {
      truncated = true;
      break;
    }
    inspect();
    offset++;
    scannedCells++;
  }
  const invalid = !!c.invalid || issues.some((i) => i.severity === "error");
  return {
    valid: truncated ? null : !invalid,
    issues,
    scannedCells,
    nextCursor: truncated ? next(tx, c, offset, invalid) : null,
    truncated,
  };
}
