/** Frozen B0 contract. No DOM, Node, editor or transport implementation dependencies. */
import type { EntityFieldType, EntityFieldValue, MapStore, Project, ProjectData, ProjectSettings, Stamp, Tileset, WorldHistoryEntry } from "@smap/core";

import type { AgentEditorControlsPort, ConfigureExportArgs, EditorExportPreferences, ConfigureApplicationArgs, ConfigureEditorArgs, ConfigureLayoutArgs, EditorControlContext, EditorControlState, EditorControlToolName, ListEditorCommandsArgs, RunEditorCommandArgs } from "./editorControls";

import type {CollaborativeBegin,CollaborativeJoin,CollaborationSummary,RegionClaim} from "./collaboration";
import type { AgentReferencePort, ReferenceSummary, VisionToolArguments, VisionToolData, VisionToolName } from "./vision";

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };
export type Unsubscribe = () => void;
export type Id = string;
export type Revision = number;
export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
/** Compact D4 bits: H=1, V=2, D=4 (never raw Uint32 high bits). */
export type Orientation = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface Tile { tilesetId: Id; tileId: number; flags?: Orientation }
export type ResolvedTile = Required<Tile>;
export type PaintValue = Tile | { collision: 0 | 1 | 2 } | null;
export interface CellWrite extends Point { value: PaintValue }
export interface LayerMapping { sourceLayerId: Id; targetLayerId: Id }
export interface ReadContext { worldSessionId: Id }
export interface WriteContext extends ReadContext { transactionId: Id; idempotencyKey: string; expectedRevision?: Revision; expectedMemberRevision?: Revision }
/** O2: tags never require a transaction or revision, even when an edit is pending. */
export interface TagWriteContext extends ReadContext { idempotencyKey: string }
export type LayerKind = "tile" | "collision" | "entity";
export type SmartUsage = "area" | "road";
export type SmartSource = { stampId: Id } | { tilesetId: Id; region: Rect };
export type TagTarget = { kind: "tile"; tilesetId: Id; tileId: number } | { kind: "stamp"; stampId: Id };
export type TagStatus = "missing" | "current" | "stale";
export interface TagWrite { target: TagTarget; expectedFingerprint: string; tags: string[]; note?: string }
export interface LayerPropsInput { name?: string; visible?: boolean; locked?: boolean; opacity?: number }
interface MapWrite { context: WriteContext; mapId: Id }
interface LayerWrite extends MapWrite { layerId: Id }
export interface GetSessionArgs { transactionId?: Id }
export interface GetEditorContextArgs { context: ReadContext }
export interface EditorContext {
  contextToken: string; activeMapId: Id | null; activeLayerId: Id | null; tool: string;
  selection: { tilesetId: Id; region: Rect; tileIds: number[]; truncated: boolean; grid: { columns: number; rows: number; tileWidth: number; tileHeight: number; margin: number; spacing: number } } | null;
  stamp: { stampId: Id | null; width: number; height: number; layerIds: Id[] } | null;
  region: { bounds: Rect; selectedCells: number; masked: boolean; mask: number[] | null; truncated: boolean } | null;
  viewport: { view: "level" | "world"; zoom: number; pixelBounds: Rect; cellBounds: Rect } | null;
  reference: { selectionToken: string; width: number; height: number } | null;
}
export interface GetMapInfoArgs { context: ReadContext; mapId: Id }
export interface ReadRegionArgs extends GetMapInfoArgs { region: Rect; layerIds: Id[]; includeEntities?: boolean }
export interface ListTilesetsArgs { context: ReadContext; cursor?: string; limit?: number; includeDetails?: boolean }
export interface GetTileCatalogArgs { context: ReadContext; tilesetId: Id; tileIds?: number[]; offset?: number; limit?: number; image?: "none" | "tiles" | "sheet"; sheetRegion?: Rect; scale?: 1 | 2 | 4; details?: boolean }
export type IngestReferenceArgs = { context: ReadContext } & ({ pngBase64: string; selectedReferenceToken?: never } | { selectedReferenceToken: string; pngBase64?: never });
export interface MatchReferenceArgs { context: ReadContext; referenceId: Id; tilesetIds?: Id[]; topK?: number; maxScale?: number }
export interface ReferenceInfo { referenceId: Id; width: number; height: number }
export interface ReferenceCandidate { tilesetId: Id; tileId: number; region: Rect; flags: Orientation; scale: number; match: "exact_rgba" }
export interface ReferenceMatches { status: "matched" | "ambiguous" | "no_match"; candidates: ReferenceCandidate[]; truncated: boolean; revision: Revision }
export interface CreateStampArgs { context: WriteContext; source: { mapId: Id; region: Rect; layerIds: Id[] } | { tilesetId: Id; region: Rect }; name: string; category?: string; tags?: string[] }
export interface ListStampsArgs { context: ReadContext; query?: string; cursor?: string; limit?: number; previewStampId?: Id; includeSheet?: boolean }
export interface BeginEditArgs { context: ReadContext; idempotencyKey: string; expectedRevision: Revision; requestLabel: string; mapIds: Id[]; collaboration?: CollaborativeBegin }
export interface FinishEditArgs { context: WriteContext; summary?: string }
export interface CancelEditArgs { context: WriteContext; reason?: string }
export interface PaintCellsArgs extends LayerWrite { cells: CellWrite[] }
export interface PaintRectArgs extends LayerWrite { region: Rect; value: PaintValue; outline?: number }
export interface PaintLineArgs extends LayerWrite { from: Point; to: Point; value: PaintValue; width?: number }
export interface FillArgs extends LayerWrite { start: Point; region: Rect; value: PaintValue; maxCells?: number }
export interface PrepareSmartSourceArgs extends MapWrite { source: SmartSource; force?: boolean }
export type SmartBrushArgs = LayerWrite & { sourceId: Id; orientation?: Orientation } & (
  { mode: "area"; region: Rect; cells?: never; erase?: false } |
  { mode: "road"; cells: Point[]; region?: never; erase?: boolean }
);
export interface DrawPathArgs extends LayerWrite { sourceId: Id; kind: "path" | "river"; points: Point[]; width?: number; orientation?: Orientation }
export interface PlaceStampArgs extends MapWrite { stampId: Id; at: Point; rotation?: 0 | 1 | 2 | 3; flipX?: boolean; flipY?: boolean; layerMapping?: LayerMapping[]; allowCreateLayers?: boolean; emptyCells?: "skip" | "erase" }
export type EditLayerArgs = MapWrite & (
  { action: "create"; name: string; kind: LayerKind; index?: number } |
  { action: "update"; layerId: Id; props: LayerPropsInput } |
  { action: "reorder"; layerId: Id; index: number }
);
export interface ListEntityTypesArgs { context: ReadContext }
export interface PlaceEntityArgs extends LayerWrite { typeId: Id; at: Point; fields?: Record<string, EntityFieldValue> }
export type EditEntityArgs = MapWrite & { entityId: Id } & (
  { action: "move"; at: Point } | { action: "update"; fields: Record<string, EntityFieldValue> } | { action: "remove" }
);
export type BatchToolName = "paint_cells" | "paint_rect" | "paint_line" | "place_stamp" | "place_entity" | "edit_entity";
type WithoutContext<T> = T extends unknown ? Omit<T, "context"> : never;
export type BatchOperation = { [N in BatchToolName]: { tool: N; args: WithoutContext<ToolArguments[N]> } }[BatchToolName];
export interface ApplyOperationsArgs { context: WriteContext; operations: BatchOperation[] }
export type GoalCheck =
  | { kind: "reachability"; region: Rect; from: Point; to: Point; collisionLayerIds: Id[]; blockedValues: (1 | 2)[]; emptyIsBlocked: boolean }
  | { kind: "region_unchanged"; region: Rect; layerIds: Id[]; expectedDigest?: string }
  | { kind: "entity_count"; region: Rect; layerIds: Id[]; typeId?: Id; min: number; max: number };
export interface ValidateGoalsArgs extends GetMapInfoArgs { checks: GoalCheck[] }
export interface GoalResult { kind: GoalCheck["kind"]; passed: boolean | null; detail: string; digest?: string; count?: number; visitedCells?: number }
export interface CreateMapArgs { context: WriteContext; name: string; width: number; height: number; tileWidth: number; tileHeight: number; world?: Point }
export interface ResizeMapArgs extends MapWrite { width: number; height: number; allowCrop?: boolean }
export interface RenderPreviewArgs extends GetMapInfoArgs { region?: Rect; layerIds?: Id[]; maxSide?: number; grid?: boolean; coordinates?: boolean; entities?: boolean; zoom?: number; highlight?: "draft" | "lastCall" }
export interface ValidateMapArgs extends GetMapInfoArgs { region?: Rect; limit?: number; cursor?: string }
export interface GetTagsArgs { context: ReadContext; query?: string; kind?: "tiles" | "stamps"; tilesetId?: Id; status?: "all" | "current" | "missing" | "stale"; cursor?: string; limit?: number }
export interface SetTagsArgs { context: TagWriteContext; entries: TagWrite[] }
export interface EditMapArgs { context: WriteContext; mapId: Id; name?: string; world?: Point }
export type EditStampArgs = { context: WriteContext; stampId: Id } & ({ action: "remove" } | { action: "duplicate"; name: string } | { action: "update"; props: {name?: string; category?: string; tags?: string[]; favorite?: boolean} });
export interface ConfigureWorldArgs { context: WriteContext; settings: {tileWidth?: number;tileHeight?: number;newLevel?:{width?:number;height?:number};layerTemplate?:{name:string;kind:LayerKind}[];background?:string|null} }

export interface ToolArguments extends VisionToolArguments {
  join_edit: CollaborativeJoin;
  get_export_settings: EditorControlContext; configure_export: ConfigureExportArgs;
  edit_map: EditMapArgs; edit_stamp: EditStampArgs; configure_world: ConfigureWorldArgs; get_world_settings: { context: ReadContext };
  get_editor_state: EditorControlContext; configure_editor: ConfigureEditorArgs; configure_layout: ConfigureLayoutArgs; configure_application: ConfigureApplicationArgs; list_editor_commands: ListEditorCommandsArgs; run_editor_command: RunEditorCommandArgs;
  get_editor_context: GetEditorContextArgs; apply_operations: ApplyOperationsArgs; edit_entity: EditEntityArgs; validate_goals: ValidateGoalsArgs;
  visual_ingest_reference: IngestReferenceArgs; visual_match_reference: MatchReferenceArgs; create_stamp: CreateStampArgs;
  get_session: GetSessionArgs; get_map_info: GetMapInfoArgs; read_region: ReadRegionArgs;
  list_tilesets: ListTilesetsArgs; get_tile_catalog: GetTileCatalogArgs; list_stamps: ListStampsArgs;
  begin_edit: BeginEditArgs; finish_edit: FinishEditArgs; cancel_edit: CancelEditArgs;
  paint_cells: PaintCellsArgs; paint_rect: PaintRectArgs; paint_line: PaintLineArgs; fill: FillArgs;
  prepare_smart_source: PrepareSmartSourceArgs; smart_brush: SmartBrushArgs; draw_path: DrawPathArgs;
  place_stamp: PlaceStampArgs; edit_layer: EditLayerArgs; list_entity_types: ListEntityTypesArgs;
  place_entity: PlaceEntityArgs; create_map: CreateMapArgs; resize_map: ResizeMapArgs;
  render_preview: RenderPreviewArgs; validate_map: ValidateMapArgs; get_tags: GetTagsArgs; set_tags: SetTagsArgs;
}
export type ToolName = keyof ToolArguments;

export const AGENT_LIMITS = {
  cellsPerCall: 4096, readCellsPerLayer: 4096, readCellsTotal: 16384, readLayers: 8,
  fillCells: 4096, mutationCalls: 256, transactionPlannedWrites: 262144,
  retainedBytes: 64 * 1024 * 1024, targetMaps: 8, metadataParticipants: 256,
  mapDimension: 4096, mapArea: 1048576, sourceWidth: 32, sourceHeight: 32,
  layersPerMap: 128, layerNameLength: 128, catalogPage: 128, catalogImagePage: 64,
  stampsPage: 32, tagsPage: 128, tagBatch: 128, tagWords: 16, tagWordLength: 48,
  imageSide: 2048, imagePixels: 4194304, pngBytes: 4 * 1024 * 1024, imagesPerCall: 1,
  responseBytes: 8 * 1024 * 1024, requestBytes: 1024 * 1024, jsonDepth: 32,
  callTimeoutMs: 10000, imageSourceTimeoutMs: 30000, beginDrainTimeoutMs: 30000,
  queuePerClient: 32, queueTotal: 64, editLifetimeMs: 30 * 60 * 1000,
  // O9: review inactivity is advisory; stopped/review work never rolls back automatically.
  reviewIdleMs: 10 * 60 * 1000, sessionIdleMs: 5 * 60 * 1000, clients: 16,
  activityEntries: 1000, entitiesPerRead: 256, tagsFileBytes: 8 * 1024 * 1024,
  tileTagRecords: 100000, stampTagRecords: 10000, tagsDebounceMs: 500,
  proxyPingMs: 30000, defaultDesktopPort: 48765, defaultDevPort: 48766,
} as const;
export type AgentLimits = typeof AGENT_LIMITS;
/** Stable application diagnostics; protocol and HTTP errors are separate. */
export enum AgentErrorCode {
  REGION_CONFLICT = "REGION_CONFLICT", OUTSIDE_REGION = "OUTSIDE_REGION", MEMBER_REVISION_CONFLICT = "MEMBER_REVISION_CONFLICT", EXCLUSIVE_OPERATION_REQUIRED = "EXCLUSIVE_OPERATION_REQUIRED",
  NO_WORLD = "NO_WORLD", STALE_WORLD = "STALE_WORLD", EDITOR_UNAVAILABLE = "EDITOR_UNAVAILABLE",
  WRITER_BUSY = "WRITER_BUSY", TRANSACTION_REQUIRED = "TRANSACTION_REQUIRED",
  TRANSACTION_NOT_OWNED = "TRANSACTION_NOT_OWNED", TRANSACTION_SEALED = "TRANSACTION_SEALED",
  TRANSACTION_CANCELLED = "TRANSACTION_CANCELLED", REVISION_CONFLICT = "REVISION_CONFLICT",
  IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT", INVALID_ARGUMENT = "INVALID_ARGUMENT",
  UNKNOWN_ID = "UNKNOWN_ID", OUT_OF_BOUNDS = "OUT_OF_BOUNDS", LAYER_LOCKED = "LAYER_LOCKED",
  LAYER_HIDDEN = "LAYER_HIDDEN", LAYER_KIND = "LAYER_KIND", GRID_MISMATCH = "GRID_MISMATCH",
  SOURCE_NOT_SMART = "SOURCE_NOT_SMART", SOURCE_CHANGED = "SOURCE_CHANGED",
  STAMP_MAPPING_REQUIRED = "STAMP_MAPPING_REQUIRED", CROP_REQUIRES_EXPLICIT_ALLOW = "CROP_REQUIRES_EXPLICIT_ALLOW",
  ENTITY_SCHEMA = "ENTITY_SCHEMA", TAG_FINGERPRINT_CHANGED = "TAG_FINGERPRINT_CHANGED",
  DISK_CONFLICT = "DISK_CONFLICT", LIMIT_EXCEEDED = "LIMIT_EXCEEDED", TIMEOUT = "TIMEOUT",
  CANCELLED = "CANCELLED", INTERNAL_ERROR = "INTERNAL_ERROR",
}
export class AgentError extends Error {
  constructor(readonly code: AgentErrorCode, message: string, readonly details: JsonObject = {}, readonly retryable = false) {
    super(message); this.name = "AgentError";
  }
}
/** Enabled lifecycle: ready → preparing → running → stopped/awaitingApproval → ready.
 * Approval from running/stopped/review finalizes to ready; failure during preparation returns ready.
 * Cancellation from any pending phase passes through cancelling before ready/disabled.
 * Only ready can become disabled directly. Stopped/review never resume writes or auto-finalize.
 */
export type AgentPhase = "disabled" | "ready" | "preparing" | "running" | "stopped" | "awaitingApproval" | "cancelling";
export type TransactionState = "preparing" | "running" | "stopped" | "awaitingApproval" | "cancelling" | "approved" | "cancelled";
export interface ClientInfo { name: string; version: string }
/** A null session detaches sealed review from the client; its name remains for the user. */
export interface TransactionOwner { clientSessionId: Id | null; clientInfo: ClientInfo }
export interface TransactionCounters { mutationCalls: number; plannedWrites: number; changedCells: number; retainedBytes: number }
export interface TransactionSummary {
  id: Id; state: TransactionState; label: string; owner: TransactionOwner; startedAt: number;
  leaseDeadline: number; affectedMapIds: Id[]; counters: TransactionCounters; collaboration?: CollaborationSummary;
  outcome?: "approved" | "cancelled"; historyEntryId?: number;
}
export interface AgentState {
  phase: AgentPhase; instanceId: Id; worldSessionId: Id | null; revision: Revision;
  committedRevision: Revision; transaction: TransactionSummary | null;
}
export interface LayerInfo { id: Id; name: string; kind: LayerKind; index: number; visible: boolean; locked: boolean; opacity: number }
export interface MapSummary { id: Id; name: string; width?: number | null; height?: number | null; tileWidth?: number | null; tileHeight?: number | null; world: Point; loaded: boolean; dirty: boolean }
export interface MapInfo { id: Id; name: string; width: number; height: number; tileWidth: number; tileHeight: number; seed: number; world: Point; mapRevision: Revision }
export interface CreatedMapInfo { id: Id; name: string; path: string; width: number; height: number; tileWidth: number; tileHeight: number; world: Point }
export interface WorldInfo { name: string; locationLabel: string; saved: boolean; dirty: boolean }
export interface SessionClient extends ClientInfo { state: "connected" | "idle"; isWriter: boolean }
export interface ChangeSummary {
  plannedCells: number; changedCells: number;
  affected: { mapId: Id; mapRevision: Revision; layerId?: Id; bounds?: Rect }[];
  createdLayerIds: Id[]; createdEntityIds: Id[];
}
export interface ChangedData { change: ChangeSummary }
export interface EntityInfo { id: Id; typeId: Id; layerId: Id; pixelX: number; pixelY: number; fields: Record<string, EntityFieldValue> }
export interface TagRecord { target: TagTarget; tags: string[]; note: string; status: TagStatus; storedFingerprint?: string; currentFingerprint: string | null }
export interface UpdatedTag { target: TagTarget; fingerprint: string; tags: string[]; note: string; status: "current" }
export interface ImagePlacement { tileId: number; rect: Rect; labelRect: Rect }
export interface CatalogImage { width: number; height: number; mode: "tiles" | "sheet"; scale: number; columns?: number; placements?: ImagePlacement[]; sheet?: { region: Rect; sourceRect: Rect; grid: { columns: number; rows: number; tileWidth: number; tileHeight: number; margin: number; spacing: number }; contentRect: Rect } }
export interface TagCounts { current: number; stale: number; missing: number }
export interface TilesetInfo { id: Id; name: string; tileWidth: number; tileHeight: number; columns: number; rows: number; margin: number; spacing: number; tileCount: number; kind: "source" | "generated" | "edited"; fingerprint?: string; tagCounts?: TagCounts }
/** Compact by default: tileId plus non-empty tags/note; details:true adds the rest. */
export interface TileCatalogItem { tileId: number; sourceRect?: Rect; tags?: string[]; note?: string; tagStatus?: TagStatus; fingerprint?: string }
export interface StampInfo { id: Id; name: string; width: number; height: number; layers: { sourceLayerId: Id; name: string; kind: LayerKind }[]; category: string; tags: string[]; semanticTags: string[]; smartUsages: SmartUsage[]; fingerprint: string }
export interface EntityTypeInfo { id: Id; name: string; builtin: boolean; fields: { name: string; type: EntityFieldType; default: EntityFieldValue; enumValues?: string[] }[] }
export interface PreviewImage { width: number; height: number; scale: number; pixelOrigin: Point; cellSize: { width: number; height: number }; contentRect: Rect; grid: boolean; coordinates: boolean }
export interface AgentWarning { code: string; detail: string }
export interface ValidationIssue { severity: "error" | "warning"; code: string; mapId: Id; layerId?: Id; x?: number; y?: number; entityId?: Id; detail: string }
export interface ToolData extends VisionToolData {
  join_edit: { transactionId: Id; memberId: Id; memberRevision: Revision; state: "running"; claims: RegionClaim[]; revisionMode: "member" };
  get_export_settings: EditorExportPreferences; configure_export: EditorExportPreferences;
  edit_map: ChangedData & { map: MapSummary }; edit_stamp: ChangedData & { stamp: {id: Id;name:string;width:number;height:number;category:string;tags:string[];favorite:boolean}|null;stampId:Id;action:EditStampArgs["action"] };
  configure_world: ChangedData & { settings: ProjectSettings }; get_world_settings: { settings: ProjectSettings };
  get_editor_state: EditorControlState; configure_editor: EditorControlState; configure_layout: EditorControlState; configure_application: EditorControlState;
  list_editor_commands: ReturnType<AgentEditorControlsPort["listCommands"]>; run_editor_command: ReturnType<AgentEditorControlsPort["runCommand"]>;
  get_editor_context: EditorContext;
  apply_operations: ChangedData & { items: { tool: BatchToolName; changedCells: number; entityId?: Id }[] };
  edit_entity: ChangedData & { entity: EntityInfo | null; entityId: Id; action: EditEntityArgs["action"] };
  validate_goals: { valid: boolean | null; checks: GoalResult[]; scannedCells: number };
  visual_ingest_reference: ReferenceInfo;
  visual_match_reference: ReferenceMatches;
  create_stamp: ChangedData & { stampId: Id; name: string; width: number; height: number; sourceLayerIds: Id[] };
  get_session: { currentClientSessionId: Id; apiVersion: 1; toolCatalogueHash: string; world: WorldInfo | null; maps: MapSummary[]; activeMapId: Id | null; activeLayerId: Id | null; clients: SessionClient[]; transaction: TransactionSummary | null; limits: AgentLimits;
    /** Reference images the user dropped/pasted or the agent added (reference_add). */
    references: ReferenceSummary[] };
  get_map_info: { map: MapInfo; layers: LayerInfo[]; entityCount: number; dirty: boolean };
  read_region: { region: Rect; legend: ResolvedTile[]; layers: ({ id: Id; kind: "tile" | "collision"; cells: number[] } | { id: Id; kind: "entity" })[]; entities: EntityInfo[] };
  list_tilesets: { items: TilesetInfo[]; nextCursor: string | null };
  get_tile_catalog: { tilesetId: Id; items: TileCatalogItem[]; image?: CatalogImage; nextOffset?: number };
  list_stamps: { items: StampInfo[]; nextCursor: string | null; image?: { width: number; height: number; stampId?: Id; sheet?: { stampId: Id; label: string; rect: Rect }[] } };
  begin_edit: { memberId?:Id;memberRevision?:Revision;revisionMode?:"member";transactionId: Id; state: "running"; baseRevision: Revision; protectedLayers: { mapId: Id; layerId: Id; locked: boolean; hidden: boolean }[]; limits: AgentLimits; leaseDeadline: number };
  finish_edit: { transactionId: Id; state: "running" | "awaitingApproval"; summary: string; counters: TransactionCounters; requiresUserApproval: true; memberId?: Id; memberState?: "ready" };
  cancel_edit: { transactionId: Id; state: "cancelled"; reason: string; rolledBack: true; scope?: "member"; memberId?: Id; sharedResourcesRetained?: boolean };
  paint_cells: ChangedData; paint_rect: ChangedData; paint_line: ChangedData; fill: ChangedData & { filledCells: number };
  prepare_smart_source: ChangedData & { sourceId: Id; mapId: Id; band: number; usages: SmartUsage[]; detectorVersion: number; fingerprint: string; forced: boolean; generatedTilesetIds: Id[]; layerMapping: LayerMapping[] };
  smart_brush: ChangedData & { sourceId: Id; neighborRepairs: number; layerMapping: LayerMapping[] };
  draw_path: ChangedData & { sourceId: Id; kind: "path" | "river"; snappedPoints: Point[]; widthInTiles: number; neighborRepairs: number };
  place_stamp: ChangedData & { stampId: Id; layerMapping: LayerMapping[]; transformedSize: { width: number; height: number } };
  edit_layer: ChangedData & { layer: LayerInfo };
  list_entity_types: { items: EntityTypeInfo[] };
  place_entity: ChangedData & { entity: EntityInfo };
  create_map: ChangedData & { map: CreatedMapInfo; layers: LayerInfo[] };
  resize_map: ChangedData & { map: MapInfo; cropped: { cells: number; entities: number } };
  render_preview: { mapId: Id; region: Rect; mapRevision: Revision; image: PreviewImage; warnings: AgentWarning[] };
  validate_map: { valid: boolean | null; issues: ValidationIssue[]; scannedCells: number; nextCursor: string | null; truncated: boolean };
  get_tags: { items: TagRecord[]; nextCursor: string | null };
  set_tags: ChangedData & { updated: UpdatedTag[] };
}
export type MutationToolName = Exclude<ToolName, EditorControlToolName | "get_world_settings" | "get_editor_context" | "validate_goals" | "visual_ingest_reference" | "visual_match_reference" | "get_session" | "get_map_info" | "read_region" | "list_tilesets" | "get_tile_catalog" | "list_stamps" | "list_entity_types" | "render_preview" | "validate_map" | "get_tags" | "set_tags" | VisionToolName>;
export interface AgentEnvelope<T> { memberId?: Id; memberRevision?: Revision; ok: true; instanceId: Id; worldSessionId: Id | null; revision: Revision; tentative: boolean; data: T }
export type ToolSuccess<N extends ToolName = ToolName> = N extends ToolName ? AgentEnvelope<ToolData[N]> & (N extends MutationToolName ? { transactionId: Id; transactionState: TransactionState; replayed: boolean } : N extends "set_tags" ? { replayed: boolean } : object) : never;
export interface AgentFailure { memberId?:Id;memberRevision?:Revision;ok: false; code: AgentErrorCode; message: string; worldSessionId: Id | null; revision: Revision; transactionId?: Id; retryable: boolean; details: JsonObject }
export interface TextBlock { type: "text"; text: string }
export interface ImageBlock { type: "image"; mimeType: "image/png"; data: string }
/** Exactly one stable JSON text block, optionally followed by one PNG. Never embed PNG in JSON. */
export type AgentToolResult<N extends ToolName = ToolName> =
  | { isError?: false; content: [TextBlock] | [TextBlock, ImageBlock]; structuredContent: ToolSuccess<N> }
  | { isError: true; content: [TextBlock]; structuredContent: AgentFailure };
export interface AgentToolDefinition { name: ToolName; title: string; description: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: false }; inputSchema: { readonly type: "object"; readonly $schema: string; readonly [key: string]: JsonValue } }
export interface AgentSignal { readonly aborted: boolean; throwIfAborted(): void; onAbort(callback: () => void): Unsubscribe }
/** Only transport-authenticated values belong here. Epoch/deadline times are milliseconds. */
export interface AgentCallContext { clientSessionId: Id; clientInfo: ClientInfo; bridgeEpoch: Id; deadline: number; signal: AgentSignal }
/** Arguments remain untrusted until schema and semantic validation at executeTool. */
export interface AgentCall extends AgentCallContext { name: string; arguments: unknown }
export type TypedAgentCall<N extends ToolName = ToolName> = N extends ToolName ? AgentCallContext & { name: N; arguments: ToolArguments[N] } : never;
export interface AgentApi {
  executeTool(call: AgentCall): Promise<AgentToolResult>;
  describeTools(): readonly AgentToolDefinition[];
  sessionEnded(clientSessionId: Id): Promise<void>;
  userAction(action: "stop" | "approve" | "discard"): Promise<void>;
  /** Close admission, cancel pending work, and release host subscriptions. */
  dispose(): Promise<void>;
  getState(): AgentState;
  subscribe(listener: (state: AgentState) => void): Unsubscribe;
}

/** Signature only: core implements these structural ports without importing @smap/agent. */
export interface EditLease { readonly owner: object; run<T>(apply: () => T extends PromiseLike<unknown> ? never : T): T; release(): void }
export interface LeaseableMapStore { acquireEditLease(owner: object): EditLease; readonly transactionDepth: number }
export interface ProjectHistoryPatch { apply(side: "before" | "after"): void }
export interface PendingWorldGroup {
  finish(commitStores: () => void, projectPatch?: ProjectHistoryPatch): WorldHistoryEntry | null;
  cancel(rollbackStoresAndMetadata: () => void): void;
}
export interface PendingWorldHistoryPort { beginPending(originMapId: Id, label: string): PendingWorldGroup }
/** Admission is acquired synchronously at writer entry, before preparation/enqueue awaits. */
export interface SaveAdmission { readonly worldSessionId: Id; assertAllowed(): void; release(): void }
export interface AgentEditAdmission { readonly worldSessionId: Id; waitForWrites(signal: AgentSignal, deadline: number): Promise<void>; assertCurrent(): void; release(outcome: "approved" | "cancelled" | "failed"): void }
export interface AgentWriteGate {
  readonly blocked: boolean;
  admitSave(worldSessionId: Id): SaveAdmission;
  acquireEdit(worldSessionId: Id): AgentEditAdmission;
  assertSaveAllowed(worldSessionId: Id): void;
  subscribe(listener: () => void): Unsubscribe;
}
export interface AgentSessionSnapshot { instanceId: Id; worldSessionId: Id | null; revision: Revision; world: WorldInfo | null; maps: MapSummary[]; activeMapId: Id | null; activeLayerId: Id | null; clients: SessionClient[] }
export interface AgentGeneratedRecipe { readonly tilesetId: Id; readonly stamp: Stamp }
export interface MapPersistenceBaseline { readonly mapId: Id; readonly store: MapStore; readonly dirty: boolean; readonly knownText: string | null }
export interface MetadataSnapshot {
  readonly project: Project; readonly recipes: readonly AgentGeneratedRecipe[];
  readonly stamps: readonly Stamp[]; readonly brokenStampFiles: readonly string[];
  readonly dirty: boolean; readonly libraryRevision: number;
  readonly knownText: readonly { path: string; text: string | null }[];
  readonly pendingRemovals: readonly string[];
}
/** Persistence bookkeeping only; MapStore rollback owns document/palette/history restoration.
 * Tags are deliberately excluded: independent O2 writes must survive map cancellation.
 */
export interface AgentBaseline {
  readonly worldSessionId: Id; readonly editorDirty: boolean;
  readonly maps: readonly MapPersistenceBaseline[]; readonly metadata: MetadataSnapshot;
}
/** Map membership is provisional until approval; it never enters world undo (O1). */
export type AgentMetadataOperation =
  | { kind: "stamps"; before: readonly Stamp[]; after: readonly Stamp[] }
  | { kind: "worldSettings"; before: ProjectSettings; after: ProjectSettings }
  | { kind: "mapName"; mapId: Id; before: string; after: string }
  | { kind: "mapPosition"; mapId: Id; before: Point; after: Point }
  | { kind: "recipes"; before: readonly AgentGeneratedRecipe[]; after: readonly AgentGeneratedRecipe[] }
  | { kind: "projectData"; mapId: Id; before: ProjectData; after: ProjectData };
export interface AgentMetadataPort {
  snapshot(): MetadataSnapshot;
  stage(operation: AgentMetadataOperation): void;
  restore(snapshot: MetadataSnapshot): void;
  patch(): ProjectHistoryPatch | undefined;
  publish(): void;
}
export interface PreparedAgentMap { map: CreatedMapInfo; store: MapStore }
export interface AgentWorldPort {
  maps(): readonly MapSummary[];
  tilesets(): readonly Tileset[];
  stamps(): readonly Stamp[];
  entityTypes(): readonly EntityTypeInfo[];
  settings(): ProjectSettings;
  loadMap(mapId: Id): Promise<MapStore>;
  pinMap(mapId: Id): Unsubscribe;
  prepareAgentMap(args: CreateMapArgs, signal: AgentSignal): Promise<PreparedAgentMap>;
  stageAgentMap(prepared: PreparedAgentMap): void;
  removeProvisionalMap(mapId: Id): void;
  approveProvisionalMap(mapId: Id): void;
  subscribeContent(listener: () => void): Unsubscribe;
}
export interface AgentImageResult { png: Uint8Array; width: number; height: number; revision: Revision; warnings: AgentWarning[] }
export interface AgentVisualReferencePort {
  ingestReference(args: IngestReferenceArgs, call: AgentCallContext): Promise<ReferenceInfo>;
  matchReference(args: MatchReferenceArgs, call: AgentCallContext): Promise<ReferenceMatches>;
  sessionEnded(clientSessionId: Id): void;
  clear(): void;
}
export interface AgentImagePort {
  catalogSourceKey?(tilesetId: Id): string | null;
  tileCatalog(args: GetTileCatalogArgs, call: AgentCallContext): Promise<AgentImageResult & { image: CatalogImage }>;
  stampPreview(stampId: Id, call: AgentCallContext): Promise<AgentImageResult>;
  /** One labelled contact sheet of several stamps (list_stamps includeSheet). */
  stampSheet?(stampIds: readonly Id[], call: AgentCallContext): Promise<AgentImageResult & { sheet: { stampId: Id; label: string; rect: Rect }[] }>;
  renderPreview(args: RenderPreviewArgs, call: AgentCallContext): Promise<AgentImageResult & { image: PreviewImage; region: Rect; mapRevision: Revision }>;
  tileFingerprint(tilesetId: Id, tileId: number, signal: AgentSignal): Promise<string>;
  stampFingerprint(stampId: Id, signal: AgentSignal): Promise<string>;
}
export interface PreparedSmartSource { sourceId: Id; transactionId: Id; mapId: Id; band: number; usages: SmartUsage[]; detectorVersion: number; fingerprint: string; forced: boolean; generatedTilesetIds: Id[]; layerMapping: LayerMapping[]; retainedBytes: number; stamp: Stamp; tilesets: readonly Tileset[] }
/** Preparation must stage assets; publication is synchronous under the transaction's edit lease. */
export interface AgentSmartSourcePort {
  prepare(args: PrepareSmartSourceArgs, call: AgentCallContext, reserve?: (retainedBytes: number) => void): Promise<PreparedSmartSource>;
  /** Release a private preparation rejected before publication. */
  discard(source: PreparedSmartSource): void;
  get(sourceId: Id): PreparedSmartSource | undefined;
  assertCurrent(source: PreparedSmartSource): void;
  publish(source: PreparedSmartSource): void;
  releaseTransaction(transactionId: Id, outcome: "approved" | "cancelled"): void;
}
export interface TileTagEntry { tilesetId: Id; tileId: number; fingerprint: string; tags: string[]; note: string }
export interface StampTagEntry { stampId: Id; fingerprint: string; tags: string[]; note: string }
/** O2 spelling is tagFormatVersion (singular), overriding the primary plan's sample. */
export interface TagsSidecar { format: "smap-ai-tags"; tagFormatVersion: 1; tiles: TileTagEntry[]; stamps: StampTagEntry[] }
export type TagsAvailability = { state: "ready"; sidecar: TagsSidecar } | { state: "unavailable"; reason: "malformed" | "futureVersion" | "oversized" | "io"; detail: string };
export interface AgentTagsPort {
  availability(): TagsAvailability;
  get(args: GetTagsArgs, call: AgentCallContext): Promise<ToolData["get_tags"]>;
  set(args: SetTagsArgs, call: AgentCallContext): Promise<ToolData["set_tags"]>;
  subscribe(listener: () => void): Unsubscribe;
  flush(): Promise<void>;
}
export interface ActivityLogEntry { memberId?: Id; requestBytes?: number; textBytes?: number; imageBytes?: number; resultBytes?: number; id: Id; timestamp: number; clientInfo: ClientInfo | null; clientSessionId: Id | null; tool: ToolName | null; requestId: Id | null; transactionId: Id | null; mapIds: Id[]; status: "started" | "succeeded" | "failed" | "cancelled" | "approved" | "stopped"; plannedCells: number; changedCells: number; durationMs: number; code?: AgentErrorCode; summary: string }
export interface AgentActivityPort { append(entry: ActivityLogEntry): void; entries(): readonly ActivityLogEntry[]; subscribe(listener: () => void): Unsubscribe }
export interface AgentClock { now(): number; schedule(delayMs: number, callback: () => void): Unsubscribe }
export interface AgentIds { next(kind: "member" | "instance" | "world" | "transaction" | "source" | "entity" | "map" | "layer" | "activity" | "cursor"): Id }
export interface AgentTransactionsPort {
  readonly history: PendingWorldHistoryPort;
  readonly writeGate: AgentWriteGate;
  acquireLease(mapId: Id, store: MapStore, owner: object): EditLease;
  assertCanBegin(): void;
  captureBaseline(mapIds: readonly Id[]): AgentBaseline;
  restoreBaseline(baseline: AgentBaseline): void;
  finalized(outcome: "approved" | "cancelled"): void;
}
export interface AgentHost {
  session(): AgentSessionSnapshot;
  loadMap(mapId: Id): Promise<MapStore>;
  subscribeWorldContent(listener: () => void): Unsubscribe;
  world: AgentWorldPort; transactions: AgentTransactionsPort; metadata: AgentMetadataPort;
  visualReferences?: AgentVisualReferencePort;
  references?: AgentReferencePort;
  editorContext?: () => EditorContext;
  editorControls?: AgentEditorControlsPort;
  images: AgentImagePort; smartSources: AgentSmartSourcePort; tags: AgentTagsPort;
  activity: AgentActivityPort; clock: AgentClock; ids: AgentIds;
}

export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18"] as const;
export type McpProtocolVersion = typeof MCP_PROTOCOL_VERSIONS[number];
export interface BridgeCorrelation { requestId: Id; bridgeEpoch: Id; clientSessionId: Id }
/** Only tools/call crosses the bridge; transport serves initialize/list/ping itself. */
export interface BridgeRequest extends BridgeCorrelation { type: "tools/call"; clientInfo: ClientInfo; deadline: number; name: string; arguments: JsonObject }
export type BridgeFailureCode = "EDITOR_UNAVAILABLE" | "TIMEOUT" | "CANCELLED" | "LIMIT_EXCEEDED" | "STALE_EPOCH" | "INTERNAL_ERROR";
export type BridgeReply = BridgeCorrelation & (
  { type: "result"; result: AgentToolResult } |
  { type: "failure"; error: { code: BridgeFailureCode; message: string } }
);
export type BridgeControl =
  | { type: "sessionEnded"; bridgeEpoch: Id; clientSessionId: Id; reason: "delete" | "expired" | "disabled" | "tokenRegenerated" | "disconnect" | "shutdown" }
  | { type: "sessionStarted"; bridgeEpoch: Id; clientSessionId: Id; clientInfo: ClientInfo }
  | { type: "statusRequest"; bridgeEpoch: Id; requestId: Id }
  | { type: "cancel"; bridgeEpoch: Id; clientSessionId: Id; requestId: Id; reason: "timeout" | "clientCancelled" };
export interface AgentSettings { enabled: boolean; port: number }
export interface AgentSettingsSnapshot { revision: number; settings: AgentSettings }
export type AgentConnectionState = "disabled" | "starting" | "listening" | "connected" | "portInUse" | "failed";
export interface AgentConnectionStatus { state: AgentConnectionState; port: number; clients: ClientInfo[]; detail?: string }
export type SettingsWriteResult = { ok: true; snapshot: AgentSettingsSnapshot; status: AgentConnectionStatus } | { ok: false; code: "CONFLICT" | "PORT_IN_USE" | "INVALID_ARGUMENT" | "IO"; snapshot: AgentSettingsSnapshot; status: AgentConnectionStatus };
export interface AgentPublishedStatus { bridgeEpoch: Id; requestId?: Id; state: AgentState }
export interface AgentConnection {
  onRequest(handler: (request: BridgeRequest) => void): Unsubscribe;
  reply(reply: BridgeReply): Promise<void>;
  onControl(handler: (control: BridgeControl) => void): Unsubscribe;
  publishStatus(status: AgentPublishedStatus): Promise<void>;
  ready(bridgeEpoch: Id): Promise<void>;
  getSettings(): Promise<AgentSettingsSnapshot>;
  /** Compare-and-set prevents settings/token updates from restoring stale endpoint state. */
  setSettings(settings: AgentSettings, expectedRevision: number): Promise<SettingsWriteResult>;
  revealToken(): Promise<string>;
  copyToken(): Promise<void>;
  regenerateToken(expectedRevision: number): Promise<AgentSettingsSnapshot>;
  readonly status: AgentConnectionStatus;
  subscribeStatus(listener: (status: AgentConnectionStatus) => void): Unsubscribe;
  /** Reads an agent-supplied local reference image (reference_add path). Absent when the host cannot. */
  readLocalImage?(path: string): Promise<Uint8Array>;
}
