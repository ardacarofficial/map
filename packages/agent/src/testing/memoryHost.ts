/** Deterministic reference adapter using the production map operations and history.
 * No timers, files, UI or native globals: tests advance the clock explicitly. */
import {
  MapStore,
  WorldHistory,
  buildRoadProfile,
  createDocument,
  detectNineSliceSelection,
  findSmartCandidates,
  encodeRgbaPng,
  isValidTileId,
  nineSliceProblem,
  normalizeProject,
  prepareNineSliceTileset,
  serializeLevel,
  serializeProject,
  stampLayerMapping,
  tileRect,
  type EntityType,
  type Project,
  type ProjectSettingsInput,
  type Stamp,
  type Tileset,
} from "@smap/core";
import {
  AGENT_LIMITS as L,
  AgentErrorCode as E,
  type ActivityLogEntry,
  type AgentCall,
  type AgentClock,
  type AgentHost,
  type AgentMetadataOperation,
  type AgentSignal,
  type AgentWriteGate,
  type GetTagsArgs,
  type MapSummary,
  type MetadataSnapshot,
  type PreparedSmartSource,
  type TagRecord,
  type TagTarget,
  type TagsAvailability,
  type Unsubscribe,
} from "../contracts";
import { CallSignal } from "../transactions";
import {
  emptyTags,
  hashCanonical,
  normalizeTags,
  parseTags,
  serializeTags,
  stampFingerprint,
  tagKey,
  tileFingerprint,
} from "../tags";
import { budget, check } from "../validation";

export class MemoryClock implements AgentClock {
  #now = 0;
  #next = 0;
  readonly #timers = new Map<number, { at: number; callback: () => void }>();
  now(): number {
    return this.#now;
  }
  schedule(delayMs: number, callback: () => void): Unsubscribe {
    const id = ++this.#next;
    this.#timers.set(id, { at: this.#now + delayMs, callback });
    return () => this.#timers.delete(id);
  }
  advance(ms: number): void {
    const end = this.#now + ms;
    for (;;) {
      const next = [...this.#timers]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.#now = next[1].at;
      this.#timers.delete(next[0]);
      next[1].callback();
    }
    this.#now = end;
  }
}
export function memoryCall(
  name: string,
  args: unknown,
  overrides: Partial<Omit<AgentCall, "name" | "arguments">> = {},
): AgentCall {
  return {
    name,
    arguments: args,
    clientSessionId: "client-1",
    clientInfo: { name: "Test client", version: "1" },
    bridgeEpoch: "epoch-1",
    deadline: Number.MAX_SAFE_INTEGER,
    signal: new CallSignal(),
    ...overrides,
  };
}
export interface MemoryHostOptions {
  maps?: readonly { id: string; name?: string; store: MapStore }[];
  tilesets?: readonly Tileset[];
  stamps?: readonly Stamp[];
  entityTypes?: readonly EntityType[];
  settings?: ProjectSettingsInput;
  width?: number;
  height?: number;
}
export interface MemoryHost extends AgentHost {
  stores: Map<string, MapStore>;
  history: WorldHistory;
  clock: MemoryClock;
  pixels: Map<string, Uint8Array>;
  pins: Map<string, number>;
  snapshot(): unknown;
  changeWorld(worldId: string | null): void;
  contentChanged(): void;
  loadTags(text: string | null): void;
  readonly tagsText: string | null;
}
const DEFAULT_TILESET: Tileset = {
  id: "tiles",
  name: "Tiles",
  tileWidth: 32,
  tileHeight: 32,
  columns: 8,
  rows: 8,
  margin: 0,
  spacing: 0,
  imagePath: "tilesets/tiles.png",
};
function emitter() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit: () => {
      for (const cb of listeners) {
        try {
          cb();
        } catch {
          /* observers are diagnostic */
        }
      }
    },
  };
}

export function createMemoryHost(options: MemoryHostOptions = {}): MemoryHost {
  const stores = new Map<string, MapStore>(),
    history = new WorldHistory(),
    clock = new MemoryClock(),
    pins = new Map<string, number>(),
    pixels = new Map<string, Uint8Array>();
  const content = emitter(),
    tagEvents = emitter(),
    gateEvents = emitter(),
    activityEvents = emitter();
  let worldId: string | null = "world-1",
    revision = 0,
    blocked = false,
    libraryDirty = false,
    libraryRevision = 0,
    tagsText: string | null = null;
  const dirty = new Map<string, boolean>(),
    sourceVersions = new WeakMap<PreparedSmartSource, string>(),
    sources = new Map<string, PreparedSmartSource>(),
    log: ActivityLogEntry[] = [],
    provisional = new Set<string>();
  let recipes: MetadataSnapshot["recipes"] = [],
    stamps = [...(options.stamps ?? [])],
    tags: TagsAvailability = { state: "ready", sidecar: emptyTags() };
  const counters = new Map<string, number>();
  const ids = {
    next: (kind: Parameters<AgentHost["ids"]["next"]>[0]) => {
      let n = counters.get(kind) ?? 0;
      let candidate: string;
      do {
        candidate = `${kind}-${++n}`;
      } while (
        (kind === "map" && stores.has(candidate)) ||
        (kind === "entity" &&
          [...stores.values()].some((store) =>
            store.document.findEntity(candidate),
          )) ||
        (kind === "source" &&
          (project.tilesets.some((t) => t.id === candidate) ||
            stamps.some((s) => s.id === candidate)))
      );
      counters.set(kind, n);
      return candidate;
    },
  };
  let project: Project = normalizeProject({
    name: "Memory world",
    levels: [],
    tilesets: options.tilesets ?? DEFAULT_TILESET_ARRAY(),
    entityTypes: options.entityTypes ?? [],
    ...(options.settings ? { settings: options.settings } : {}),
  });
  const summary = (id: string): MapSummary => {
    const s = stores.get(id)!,
      level = project.levels.find((l) => l.id === id)!;
    return {
      id,
      name: level.name,
      ...s.document.map,
      world: level.world,
      loaded: true,
      dirty: dirty.get(id) ?? false,
    };
  };
  const changed = () => {
    revision++;
    content.emit();
  };
  function register(id: string, store: MapStore, name: string) {
    stores.set(id, store);
    dirty.set(id, false);
    history.register(id, store);
    let last = store.revision;
    store.subscribe(() => {
      if (store.revision !== last) {
        last = store.revision;
        dirty.set(id, true);
        changed();
      }
    });
    project = normalizeProject({
      ...project,
      levels: [
        ...project.levels,
        { id, name, path: `levels/${id}.json`, world: { x: 0, y: 0 } },
      ],
    });
  }
  if (options.maps) {
    for (const m of options.maps) register(m.id, m.store, m.name ?? m.id);
  } else {
    const store = new MapStore(
      createDocument({
        width: options.width ?? 16,
        height: options.height ?? 16,
        tilesets: project.tilesets,
        entityTypes: project.entityTypes,
      }),
    );
    for (const [id, name, type] of [
      ["ground", "Ground", "tile"],
      ["collision", "Collision", "grid"],
      ["entities", "Entities", "entity"],
    ] as const)
      store.dispatch({
        type: "addLayer",
        layer: {
          id,
          name,
          type,
          ...(type === "grid" ? { role: "collision" as const } : {}),
        },
      });
    store.clearHistory();
    register("map-1", store, "Map 1");
    counters.set("map", 1);
  }
  const getStore = async (id: string) => {
    const store = stores.get(id);
    check(store, E.UNKNOWN_ID, "Unknown map");
    return store;
  };
  const snapshotMetadata = (): MetadataSnapshot => ({
    project,
    recipes,
    stamps,
    brokenStampFiles: [],
    dirty: libraryDirty,
    libraryRevision,
    knownText: [],
    pendingRemovals: [],
  });
  let metadataBaseline: MetadataSnapshot | undefined;
  const gate: AgentWriteGate = {
    get blocked() {
      return blocked;
    },
    admitSave: (id) => {
      check(id === worldId, E.STALE_WORLD, "Stale world");
      check(!blocked, E.WRITER_BUSY, "Pending edit blocks persistence");
      return {
        worldSessionId: id,
        assertAllowed: () => {
          check(!blocked, E.WRITER_BUSY, "Pending edit blocks persistence");
        },
        release: () => {},
      };
    },
    assertSaveAllowed: (id) => {
      check(id === worldId, E.STALE_WORLD, "Stale world");
      check(!blocked, E.WRITER_BUSY, "Pending edit blocks persistence");
    },
    acquireEdit: (id) => {
      check(!blocked, E.WRITER_BUSY, "Another edit is pending");
      check(id === worldId, E.STALE_WORLD, "Stale world");
      blocked = true;
      gateEvents.emit();
      return {
        worldSessionId: id,
        waitForWrites: async (signal) => {
          signal.throwIfAborted();
        },
        assertCurrent: () => {
          check(id === worldId, E.STALE_WORLD, "Stale world");
        },
        release: () => {
          blocked = false;
          gateEvents.emit();
        },
      };
    },
    subscribe: gateEvents.subscribe,
  };
  const pixelFor = (tilesetId: string, tileId: number) => {
    const ts = project.tilesets.find((t) => t.id === tilesetId);
    check(ts && isValidTileId(ts, tileId), E.UNKNOWN_ID, "Unknown tile");
    const key = JSON.stringify([tilesetId, tileId]);
    let rgba = pixels.get(key);
    if (!rgba) {
      rgba = new Uint8Array(ts.tileWidth * ts.tileHeight * 4);
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = (tileId * 37) % 256;
        rgba[i + 1] = (tileId * 71) % 256;
        rgba[i + 2] = 113;
        rgba[i + 3] = 255;
      }
      pixels.set(key, rgba);
    }
    return { ts, rgba };
  };
  const fingerprintTile = async (
    tilesetId: string,
    tileId: number,
    signal: AgentSignal,
  ) => {
    signal.throwIfAborted();
    const { ts, rgba } = pixelFor(tilesetId, tileId);
    return tileFingerprint(ts, tileId, rgba);
  };
  const png = encodeRgbaPng(1, 1, new Uint8Array([32, 64, 96, 255]));
  const tiny = () => ({
    png: png.slice(),
    width: 1,
    height: 1,
    revision,
    warnings: [],
  });
  const host: MemoryHost = {
    stores,
    history,
    clock,
    pixels,
    pins,
    ids,
    session: () => ({
      instanceId: "instance-1",
      worldSessionId: worldId,
      revision,
      world: worldId
        ? {
            name: project.name,
            locationLabel: "Memory",
            saved: false,
            dirty: libraryDirty || [...dirty.values()].some(Boolean),
          }
        : null,
      maps: worldId ? [...stores.keys()].map(summary) : [],
      activeMapId: stores.keys().next().value ?? null,
      activeLayerId: "ground",
      clients: [],
    }),
    loadMap: getStore,
    subscribeWorldContent: content.subscribe,
    world: {
      maps: () => [...stores.keys()].map(summary),
      tilesets: () => project.tilesets,
      stamps: () => stamps,
      entityTypes: () => {
        const first = stores.values().next().value;
        return (first?.document.allEntityTypes() ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          builtin: t.id === "spawn" || t.id === "portal",
          fields: t.fields.map((f) => ({
            name: f.name,
            type: f.type,
            default: f.default,
            ...(f.enumValues ? { enumValues: [...f.enumValues] } : {}),
          })),
        }));
      },
      settings: () => project.settings,
      loadMap: getStore,
      pinMap: (id) => {
        check(stores.has(id), E.UNKNOWN_ID, "Unknown map");
        pins.set(id, (pins.get(id) ?? 0) + 1);
        return () => {
          const count = (pins.get(id) ?? 1) - 1;
          if (count) pins.set(id, count);
          else pins.delete(id);
        };
      },
      prepareAgentMap: async (a, signal) => {
        signal.throwIfAborted();
        const id = ids.next("map"),
          store = new MapStore(
            createDocument({
              width: a.width,
              height: a.height,
              tileWidth: a.tileWidth,
              tileHeight: a.tileHeight,
              tilesets: project.tilesets,
              entityTypes: project.entityTypes,
            }),
          );
        return {
          map: {
            id,
            name: a.name,
            path: `levels/${id}.json`,
            width: a.width,
            height: a.height,
            tileWidth: a.tileWidth,
            tileHeight: a.tileHeight,
            world: a.world ?? { x: 0, y: 0 },
          },
          store,
        };
      },
      stageAgentMap: (p) => {
        register(p.map.id, p.store, p.map.name);
        project = normalizeProject({
          ...project,
          levels: project.levels.map((l) =>
            l.id === p.map.id
              ? { ...l, path: p.map.path, world: p.map.world }
              : l,
          ),
        });
        provisional.add(p.map.id);
        libraryDirty = true;
        changed();
      },
      removeProvisionalMap: (id) => {
        if (!provisional.delete(id)) return;
        history.remove(id);
        stores.delete(id);
        dirty.delete(id);
        project = normalizeProject({
          ...project,
          levels: project.levels.filter((l) => l.id !== id),
        });
        changed();
      },
      approveProvisionalMap: (id) => {
        provisional.delete(id);
      },
      subscribeContent: content.subscribe,
    },
    transactions: {
      history,
      writeGate: gate,
      acquireLease: (_id, store, owner) => store.acquireEditLease(owner),
      assertCanBegin: () => {
        check(
          ![...stores.values()].some((s) => s.inTransaction),
          E.WRITER_BUSY,
          "A gesture is open",
        );
      },
      captureBaseline: (mapIds) => {
        metadataBaseline ??= snapshotMetadata();
        return {
          worldSessionId: worldId!,
          editorDirty: host.session().world!.dirty,
          maps: mapIds.map((mapId) => ({
            mapId,
            store: stores.get(mapId)!,
            dirty: dirty.get(mapId) ?? false,
            knownText: null,
          })),
          metadata: metadataBaseline,
        };
      },
      restoreBaseline: (b) => {
        for (const m of b.maps) dirty.set(m.mapId, m.dirty);
      },
      finalized: () => {
        metadataBaseline = undefined;
      },
    },
    metadata: {
      snapshot: snapshotMetadata,
      stage: (op: AgentMetadataOperation) => {
        if (op.kind === "recipes") recipes = op.after;
        else if (op.kind === "stamps") stamps = [...op.after];
        else if (op.kind === "worldSettings") project = normalizeProject({...project,settings:op.after});
        else if (op.kind === "mapName") project = normalizeProject({...project,levels:project.levels.map(l=>l.id===op.mapId?{...l,name:op.after}:l)});
        else if (op.kind === "mapPosition")
          project = normalizeProject({
            ...project,
            levels: project.levels.map((l) =>
              l.id === op.mapId ? { ...l, world: op.after } : l,
            ),
          });
        else project = normalizeProject(op.after);
        libraryDirty = true;
        libraryRevision++;
        changed();
      },
      restore: (s) => {
        project = s.project;
        recipes = s.recipes;
        stamps = [...s.stamps];
        libraryDirty = s.dirty;
        libraryRevision = s.libraryRevision;
      },
      patch: () => {
        if (!metadataBaseline) return undefined;
        const before = metadataBaseline,
          after = snapshotMetadata();
        const beforeStamps = new Map(before.stamps.map(stamp => [stamp.id, stamp])),
          afterStamps = new Map(after.stamps.map(stamp => [stamp.id, stamp])),
          changedStampIds = new Set([...beforeStamps.keys(), ...afterStamps.keys()].filter(id => beforeStamps.get(id) !== afterStamps.get(id)));
        // O1: map-list membership is deliberately excluded from world undo.
        const originalIds = new Set(before.project.levels.map((l) => l.id));
        const metadata = (s: MetadataSnapshot) => ({
          recipes: s.recipes,
          stamps: s.stamps,
          project: {
            ...s.project,
            levels: s.project.levels.filter((l) => originalIds.has(l.id)),
          },
        });
        if (hashCanonical(metadata(before)) === hashCanonical(metadata(after)))
          return undefined;
        return {
          apply: (side) => {
            const s = side === "before" ? before : after;
            recipes = s.recipes;
            stamps = [...stamps.filter(stamp => !changedStampIds.has(stamp.id)),
              ...s.stamps.filter(stamp => changedStampIds.has(stamp.id))];
            project = normalizeProject({
              ...s.project,
              levels: project.levels.map(
                (level) =>
                  s.project.levels.find((l) => l.id === level.id) ?? level,
              ),
            });
            libraryDirty = true;
            changed();
          },
        };
      },
      publish: () => {},
    },
    images: {
      tileFingerprint: fingerprintTile,
      stampFingerprint: async (id, signal) => {
        const stamp = stamps.find((s) => s.id === id);
        check(stamp, E.UNKNOWN_ID, "Unknown stamp");
        return stampFingerprint(stamp, (ts, tile) =>
          fingerprintTile(ts, tile, signal),
        );
      },
      tileCatalog: async (a, call) => {
        call.signal.throwIfAborted();
        const ts = project.tilesets.find((t) => t.id === a.tilesetId)!;
        return {
          ...tiny(),
          image: {
            width: 1,
            height: 1,
            mode: a.image === "sheet" ? "sheet" : "tiles",
            scale: a.scale ?? 1,
            placements: (a.tileIds ?? [a.offset ?? 0]).map((tileId) => ({
              tileId,
              rect: tileRect(ts, tileId),
              labelRect: { x: 0, y: 0, width: 1, height: 1 },
            })),
          },
        };
      },
      stampPreview: async (_id, call) => {
        call.signal.throwIfAborted();
        return tiny();
      },
      renderPreview: async (a, call) => {
        call.signal.throwIfAborted();
        const store = await getStore(a.mapId),
          r = a.region ?? {
            x: 0,
            y: 0,
            width: store.document.map.width,
            height: store.document.map.height,
          };
        return {
          ...tiny(),
          region: r,
          mapRevision: store.revision,
          image: {
            width: 1,
            height: 1,
            scale: 1 / (r.width * store.document.map.tileWidth),
            pixelOrigin: {
              x: r.x * store.document.map.tileWidth,
              y: r.y * store.document.map.tileHeight,
            },
            cellSize: {
              width: store.document.map.tileWidth,
              height: store.document.map.tileHeight,
            },
            contentRect: { x: 0, y: 0, width: 1, height: 1 },
            grid: a.grid ?? false,
            coordinates: a.coordinates ?? false,
          },
        };
      },
    },
    smartSources: {
      // Whole-sheet scan over the same per-tile pixels prepare uses (bounded by tests' small sheets).
      candidates: async (tilesetId, signal) => {
        signal.throwIfAborted();
        const ts = project.tilesets.find((t) => t.id === tilesetId);
        if (!ts || ts.generated || ts.edited || ts.columns * ts.rows > 4096) return [];
        const width = ts.columns * ts.tileWidth, height = ts.rows * ts.tileHeight, data = new Uint8Array(width * height * 4);
        for (let id = 0; id < ts.columns * ts.rows; id++) {
          const rgba = pixelFor(ts.id, id).rgba, col = id % ts.columns, row = Math.floor(id / ts.columns);
          for (let y = 0; y < ts.tileHeight; y++)
            data.set(rgba.subarray(y * ts.tileWidth * 4, (y + 1) * ts.tileWidth * 4), ((row * ts.tileHeight + y) * width + col * ts.tileWidth) * 4);
        }
        return findSmartCandidates({ tileset: { ...ts, margin: 0, spacing: 0 }, pixels: { width, height, data }, emptyIds: new Set() })
          .map((c) => ({ tilesetId, rect: { ...c.rect }, kind: c.kind, band: c.band }));
      },
      prepare: async (a, call, reserve) => {
        call.signal.throwIfAborted();
        const store = await getStore(a.mapId);
        let stamp: Stamp;
        let inferredBorder = 1;
        if ("stampId" in a.source) {
          const stampId = a.source.stampId;
          const found = stamps.find((s) => s.id === stampId);
          check(found, E.UNKNOWN_ID, "Unknown stamp");
          stamp = found;
        } else {
          const source = a.source,
            ts = project.tilesets.find((t) => t.id === source.tilesetId)!;
          stamp = {
            id: ids.next("source"),
            name: "Memory source",
            width: source.region.width,
            height: source.region.height,
            palette: [],
            layers: [],
          };
          const palette = [];
          for (let y = 0; y < stamp.height; y++)
            for (let x = 0; x < stamp.width; x++)
              palette.push({
                tilesetId: ts.id,
                tileId:
                  (source.region.y + y) * ts.columns + source.region.x + x,
              });
          if (!a.force) {
            const width =
                source.region.width * (ts.tileWidth + ts.spacing) - ts.spacing,
              height =
                source.region.height * (ts.tileHeight + ts.spacing) -
                ts.spacing;
            budget(width * height * 4, L.retainedBytes);
            const data = new Uint8Array(width * height * 4),
              emptyIds = new Set<number>();
            for (let y = 0; y < source.region.height; y++)
              for (let x = 0; x < source.region.width; x++) {
                const id =
                    (source.region.y + y) * ts.columns + source.region.x + x,
                  rgba = pixelFor(ts.id, id).rgba;
                if (!rgba.some((v, i) => i % 4 === 3 && v !== 0))
                  emptyIds.add(id);
                for (let row = 0; row < ts.tileHeight; row++)
                  data.set(
                    rgba.subarray(
                      row * ts.tileWidth * 4,
                      (row + 1) * ts.tileWidth * 4,
                    ),
                    ((y * (ts.tileHeight + ts.spacing) + row) * width +
                      x * (ts.tileWidth + ts.spacing)) *
                      4,
                  );
              }
            const detected = detectNineSliceSelection({
              tileset: ts,
              rect: {
                col: source.region.x,
                row: source.region.y,
                width: source.region.width,
                height: source.region.height,
              },
              ids: palette.map((p) => p.tileId),
              emptyIds,
              pixels: {
                width,
                height,
                originX:
                  ts.margin + source.region.x * (ts.tileWidth + ts.spacing),
                originY:
                  ts.margin + source.region.y * (ts.tileHeight + ts.spacing),
                data,
              },
            });
            check(
              detected,
              E.SOURCE_NOT_SMART,
              "Source pixels do not demonstrate compatible repeated bands",
            );
            inferredBorder = detected.border;
          }
          stamp = {
            ...stamp,
            palette,
            layers: [
              {
                layerId: "source",
                name: "Ground",
                cells: Uint32Array.from(palette, (_, i) => i + 1),
              },
            ],
          };
        }
        const preparedTilesets: Tileset[] = [];
        if (!stamp.nineSlice) {
          check(
            a.force || "tilesetId" in a.source,
            E.SOURCE_NOT_SMART,
            "Select a compatible repeated-band source or explicitly force preparation",
          );
          check(
            !nineSliceProblem(stamp),
            E.SOURCE_NOT_SMART,
            "Source dimensions cannot support nine-slice",
          );
          const tileLayers = stamp.layers
            .filter((l) => !l.grid)
            .map((l) => ({
              layerId: l.layerId,
              tilesetId: ids.next("source"),
            }));
          stamp = {
            ...stamp,
            nineSlice: { border: inferredBorder, tileLayers },
          };
          for (const l of tileLayers)
            preparedTilesets.push(
              prepareNineSliceTileset(stamp, l.layerId, {
                id: l.tilesetId,
                imagePath: `tilesets/${l.tilesetId}.png`,
                tileWidth: store.document.map.tileWidth,
                tileHeight: store.document.map.tileHeight,
                tilesets: project.tilesets,
                imageHashes: new Map(
                  project.tilesets.map((t) => [t.id, hashCanonical(t)]),
                ),
              }),
            );
          if (tileLayers.length === 1) {
            const baked = tileLayers[0]!;
            stamp = {
              ...stamp,
              nineSlice: {
                ...stamp.nineSlice!,
                road: {
                  tilesetId: baked.tilesetId,
                  profile: buildRoadProfile(stamp, baked.layerId),
                },
              },
            };
          }
        }
        const sourceId = ids.next("source"),
          fingerprint = hashCanonical([
            stamp.palette.map((r) => {
              const p = pixelFor(r.tilesetId, r.tileId);
              return tileFingerprint(p.ts, r.tileId, p.rgba);
            }),
            stamp.width,
            stamp.height,
          ]);
        const prepared: PreparedSmartSource = {
          sourceId,
          transactionId: a.context.transactionId,
          mapId: a.mapId,
          band: stamp.nineSlice!.border,
          usages: stamp.nineSlice!.road ? ["area", "road"] : ["area"],
          detectorVersion: 6,
          fingerprint,
          forced: !!a.force,
          generatedTilesetIds: preparedTilesets.map((t) => t.id),
          layerMapping: stampLayerMapping(store.document, stamp)
            .filter((m) => m.targetLayerId !== null)
            .map((m) => ({
              sourceLayerId: m.clipLayerId,
              targetLayerId: m.targetLayerId!,
            })),
          retainedBytes: preparedTilesets.reduce(
            (n, t) => n + t.tileWidth * t.tileHeight * t.columns * t.rows * 4,
            0,
          ),
          stamp,
          tilesets: preparedTilesets,
        };
        reserve?.(prepared.retainedBytes);
        sourceVersions.set(prepared, fingerprint);
        return prepared;
      },
      discard: (source) => { sources.delete(source.sourceId); },
      get: (id) => sources.get(id),
      assertCurrent: (s) => {
        const signature = hashCanonical([
          s.stamp.palette.map((r) => {
            const p = pixelFor(r.tilesetId, r.tileId);
            return tileFingerprint(p.ts, r.tileId, p.rgba);
          }),
          s.stamp.width,
          s.stamp.height,
        ]);
        check(
          signature === sourceVersions.get(s),
          E.SOURCE_CHANGED,
          "Source pixels changed",
        );
      },
      publish: (s) => {
        sources.set(s.sourceId, s);
        if (s.tilesets.length) {
          project = normalizeProject({
            ...project,
            tilesets: [...project.tilesets, ...s.tilesets],
          });
          recipes = [
            ...recipes,
            ...s.generatedTilesetIds.map((tilesetId) => ({
              tilesetId,
              stamp: s.stamp,
            })),
          ];
          libraryDirty = true;
          changed();
        }
      },
      releaseTransaction: (id) => {
        for (const [key, s] of sources)
          if (s.transactionId === id) {
            sources.delete(key);
            sourceVersions.delete(s);
          }
      },
    },
    tags: {
      availability: () => tags,
      subscribe: tagEvents.subscribe,
      flush: async () => {},
      get: async (a, call) => {
        call.signal.throwIfAborted();
        const targets: TagTarget[] = [];
        if ((a.kind ?? "tiles") === "tiles")
          for (const ts of project.tilesets.filter(
            (t) => !a.tilesetId || t.id === a.tilesetId,
          ))
            for (
              let tileId = 0;
              tileId < (ts.edited?.nextTileId ?? ts.columns * ts.rows);
              tileId++
            )
              targets.push({ kind: "tile", tilesetId: ts.id, tileId });
        else
          for (const s of stamps)
            targets.push({ kind: "stamp", stampId: s.id });
        if (tags.state === "ready") {
          for (const t of tags.sidecar.tiles)
            if (
              (a.kind ?? "tiles") === "tiles" &&
              (!a.tilesetId || a.tilesetId === t.tilesetId) &&
              !targets.some(
                (x) =>
                  x.kind === "tile" &&
                  x.tilesetId === t.tilesetId &&
                  x.tileId === t.tileId,
              )
            )
              targets.push({
                kind: "tile",
                tilesetId: t.tilesetId,
                tileId: t.tileId,
              });
          for (const s of tags.sidecar.stamps)
            if (
              a.kind === "stamps" &&
              !targets.some(
                (t) => t.kind === "stamp" && t.stampId === s.stampId,
              )
            )
              targets.push({ kind: "stamp", stampId: s.stampId });
        }
        const records: TagRecord[] = [];
        for (const target of targets) {
          let current: string | null = null;
          try {
            current =
              target.kind === "tile"
                ? await fingerprintTile(
                    target.tilesetId,
                    target.tileId,
                    call.signal,
                  )
                : await host.images.stampFingerprint(
                    target.stampId,
                    call.signal,
                  );
          } catch {
            call.signal.throwIfAborted();
          }
          const stored =
            tags.state === "ready"
              ? target.kind === "tile"
                ? tags.sidecar.tiles.find(
                    (t) =>
                      t.tilesetId === target.tilesetId &&
                      t.tileId === target.tileId,
                  )
                : tags.sidecar.stamps.find((t) => t.stampId === target.stampId)
              : undefined;
          const status = !stored
            ? "missing"
            : stored.fingerprint === current
              ? "current"
              : "stale";
          if (
            (a.status ?? "missing") !== "all" &&
            status !== (a.status ?? "missing")
          )
            continue;
          records.push({
            target,
            tags: stored?.tags ?? [],
            note: stored?.note ?? "",
            status,
            currentFingerprint: current,
            ...(stored ? { storedFingerprint: stored.fingerprint } : {}),
          });
        }
        const offset = a.cursor ? decodeTagCursor(a, revision) : 0,
          selected = records.slice(offset, offset + (a.limit ?? 64));
        return {
          items: selected,
          nextCursor:
            offset + selected.length < records.length
              ? `${revision}:${offset + selected.length}`
              : null,
        };
      },
      set: async (a, call) => {
        check(tags.state === "ready", E.DISK_CONFLICT, "Tags unavailable");
        check(
          new Set(a.entries.map((e) => tagKey(e.target))).size ===
            a.entries.length,
          E.INVALID_ARGUMENT,
          "Duplicate targets",
        );
        const before = tags.sidecar;
        const updates = [];
        for (const e of a.entries) {
          const target = e.target,
            current =
              target.kind === "tile"
                ? await fingerprintTile(
                    target.tilesetId,
                    target.tileId,
                    call.signal,
                  )
                : await host.images.stampFingerprint(
                    target.stampId,
                    call.signal,
                  );
          check(
            e.expectedFingerprint === current,
            E.TAG_FINGERPRINT_CHANGED,
            "Tag fingerprint changed",
          );
          updates.push({
            ...e,
            tags: normalizeTags(e.tags),
            fingerprint: current,
            note: e.note ?? "",
            status: "current" as const,
          });
        }
        call.signal.throwIfAborted();
        const next = JSON.parse(serializeTags(before)) as typeof before;
        for (const e of updates)
          if (e.target.kind === "tile") {
            const t = e.target;
            next.tiles = next.tiles.filter(
              (x) => x.tilesetId !== t.tilesetId || x.tileId !== t.tileId,
            );
            next.tiles.push({
              tilesetId: t.tilesetId,
              tileId: t.tileId,
              fingerprint: e.fingerprint,
              tags: e.tags,
              note: e.note,
            });
          } else {
            const t = e.target;
            next.stamps = next.stamps.filter((x) => x.stampId !== t.stampId);
            next.stamps.push({
              stampId: t.stampId,
              fingerprint: e.fingerprint,
              tags: e.tags,
              note: e.note,
            });
          }
        const text = serializeTags(next);
        budget(next.tiles.length, L.tileTagRecords);
        budget(next.stamps.length, L.stampTagRecords);
        if (text !== serializeTags(before)) {
          tags = { state: "ready", sidecar: next };
          tagsText = text;
          tagEvents.emit();
        }
        return {
          change: {
            plannedCells: 0,
            changedCells: 0,
            affected: [],
            createdLayerIds: [],
            createdEntityIds: [],
          },
          updated: updates.map((e) => ({
            target: e.target,
            fingerprint: e.fingerprint,
            tags: e.tags,
            note: e.note,
            status: e.status,
          })),
        };
      },
    },
    activity: {
      append: (e) => {
        log.push(e);
        if (log.length > L.activityEntries) log.shift();
        activityEvents.emit();
      },
      entries: () => log,
      subscribe: activityEvents.subscribe,
    },
    snapshot: () => ({
      project: serializeProject(project),
      maps: [...stores].map(([id, s]) => ({
        id,
        text: serializeLevel(s.document),
        dirty: dirty.get(id),
        undo: s.undoDepth,
        redo: s.redoDepth,
        head: s.peekUndo()?.id ?? null,
        redoHead: s.peekRedo()?.id ?? null,
      })),
      history: history.entries(),
      recipes: hashCanonical(recipes),
      stamps: hashCanonical(stamps),
      libraryDirty,
      libraryRevision,
    }),
    changeWorld: (id) => {
      worldId = id;
      changed();
    },
    contentChanged: changed,
    loadTags: (text) => {
      tags = parseTags(text);
      tagsText = text;
      tagEvents.emit();
    },
    get tagsText() {
      return tagsText;
    },
  };
  return host;
}
function DEFAULT_TILESET_ARRAY(): Tileset[] {
  return [DEFAULT_TILESET];
}
function decodeTagCursor(a: GetTagsArgs, revision: number): number {
  const match = /^(\d+):(\d+)$/.exec(a.cursor!);
  check(
    match && Number(match[1]) === revision,
    E.REVISION_CONFLICT,
    "Stale tag cursor",
  );
  return Number(match[2]);
}
