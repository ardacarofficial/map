/**
 * @smap/core — map data, operations, undo, save/load.
 *
 * Knows nothing about React, PixiJS, the DOM or Tauri. The editor sends
 * operations to a {@link MapStore} and listens for its change events.
 */

export {
  type Cell,
  EMPTY_CELL,
  FLIP_H,
  FLIP_V,
  FLIP_D,
  CELL_FLAG_MASK,
  CELL_INDEX_MASK,
  MAX_PALETTE_INDEX,
  MAX_CELL,
  makeCell,
  cellPaletteIndex,
  cellFlags,
  isEmptyCell,
  isValidCell,
  isValidPaletteIndex,
  withFlags,
  withPaletteIndex,
  withFlipH,
  withFlipV,
  withFlipD,
  toggleFlipH,
  toggleFlipV,
  hasFlipH,
  hasFlipV,
  hasFlipD,
  rotateCellFlags,
  type RotateDirection,
} from "./cell";

export { Palette, type PaletteEntry } from "./palette";

export {
  type Tileset,
  type GeneratedTilesetMetadata,
  type GeneratedTilesetSource,
  generatedTilesetMetadataProblem,
  normalizeGeneratedTilesetMetadata,
  generatedTilesetStale,
  type TileRect,
  tileCount,
  tileIdAt,
  tilePosition,
  tileRect,
  isValidTileId,
  gridCount,
  tilesetProblem,
  relativePathProblem,
  normalizeTileset,
} from "./tileset";

export { type CollisionGrid, collisionAt, deriveCollision } from "./collision";

export {
  CHUNK_SHIFT,
  CHUNK_SIZE,
  CHUNK_MASK,
  CHUNK_AREA,
  type ChunkKey,
  type ReadonlyChunk,
  chunkCoord,
  localCoord,
  localIndex,
  chunkKey,
  parseChunkKey,
} from "./chunk";

export {
  TileLayer,
  GridLayer,
  EntityLayer,
  isGridLayer,
  isEntityLayer,
  isTileLayer,
  isGridRole,
  type GridRole,
  MAX_GRID_VALUE,
  MAX_COLLISION_VALUE,
  COLLISION_SOLID,
  COLLISION_PASSABLE,
  type LayerType,
  type LayerProps,
  type LayerPropValues,
  type ChunkSnapshot,
  layerPropsProblem,
} from "./layer";

export {
  MapDocument,
  type MapInfo,
  type CreateDocumentOptions,
  type MapProps,
  mapPropsFrom,
  createDocument,
  mapInfoProblem,
  isValidSeed,
  uniqueLayerName,
  DOCUMENT_FORMAT_VERSION,
  DEFAULT_TILE_SIZE,
  MAX_MAP_SIZE,
} from "./document";

export type {
  Op,
  OpType,
  OpResult,
  OpResultMap,
  PaintCellsOp,
  AddTilesetOp,
  AddLayerOp,
  AddPaletteEntryOp,
  RemoveLayerOp,
  MoveLayerOp,
  SetLayerPropsOp,
  LayerPropsPatch,
  ResizeMapOp,
  PaintGridOp,
  AddEntityOp,
  RemoveEntityOp,
  MoveEntityOp,
  UpdateEntityOp,
  DefineEntityTypeOp,
  RemoveEntityTypeOp,
  NewEntity,
  GridWrite,
  NewLayer,
  CellWrite,
  CellChange,
  LayerPatch,
  UpdateTilesetGridOp,
  ReplaceTilesetImageOp,
  TilesetRemapResult,
  RemoveTilesetOp,
  SetTilesetMetaOp,
  MoveTilesetOp,
  DuplicateLayerOp,
  MergeLayerDownOp,
  LayerMergeRefusal,
  SetRandomSetOp,
  RemoveRandomSetOp,
  SetCollectionOp,
  RemoveCollectionOp,
  SetMapPropsOp,
} from "./ops";

export { LayerMergeError } from "./ops";

export {
  type TileSize,
  type CellRegion,
  type MoveRegionResult,
  type TilesetUsage,
  layerContentBounds,
  layerCellsAsRegion,
  selectAllContent,
  moveRegion,
  tilesetUsage,
} from "./region";

export { patchCellCount } from "./patch";

export {
  MapStore,
  type MapStoreOptions,
  type StoreChangeEvent,
  type StoreListener,
  type StructureChange,
  type DirtyChunks,
  type ChangeCause,
  type HistoryEntry,
  type HistoryChange,
  type CellsHistoryChange,
  type LayerHistoryChange,
  type LayerPropsHistoryChange,
  type MapHistoryChange,
  type TilesetHistoryChange,
  type TilesetListHistoryChange,
  type PaletteHistoryChange,
  type EntitiesHistoryChange,
  type EntityTypesHistoryChange,
  type RandomSetsHistoryChange,
  type CollectionsHistoryChange,
  type MapPropsHistoryChange,
  type HistoryEntryKind,
  type HistoryListItem,
} from "./store";

export {
  type Entity,
  type EntityType,
  type EntityFieldDef,
  type EntityFieldType,
  type EntityFieldValue,
  type EntityPoint,
  type ResolvedEntityField,
  ENTITY_FIELD_TYPES,
  RESERVED_ENTITY_FIELD_NAMES,
  emptyFieldRecord,
  SPAWN_TYPE_ID,
  PORTAL_TYPE_ID,
  PORTAL_TARGET_LEVEL,
  PORTAL_TARGET_POINT,
  BUILTIN_ENTITY_TYPES,
  builtinEntityType,
  isBuiltinEntityTypeId,
  isEntityFieldType,
  isEntityFieldValue,
  isEntityPoint,
  entityFieldValueProblem,
  entityTypeProblem,
  entityTypesProblem,
  entityProblem,
  normalizeEntity,
  normalizeEntityType,
  resolveEntityFields,
  defaultEntityFields,
  entitySize,
  entityCell,
} from "./entity";

export {
  type Stamp,
  type StampLayerTarget,
  type PlaceStampOptions,
  type PlaceStampResult,
  type StampMeta,
  stampMetaProblem,
  normalizeStampMeta,
  withStampMeta,
  STAMPS_DIR,
  stampIdProblem,
  stampPath,
  makeStampId,
  createStamp,
  stampLayerMapping,
  placeStamp,
} from "./stamp";

export { type RandomTile, pickRandomTile } from "./randomBrush";

export {
  type RandomCandidate,
  type RandomTileCandidate,
  type RandomStampCandidate,
  type RandomSet,
  type RandomPick,
  MAX_RANDOM_CHUNK,
  randomSetProblem,
  randomSetsProblem,
  normalizeRandomSet,
  randomChunkAt,
  pickRandomCandidate,
  remapRandomSetsForTileset,
} from "./randomSet";

export {
  type Collection,
  type CollectionCell,
  type CollectionRect,
  type CollectionClipOptions,
  MAX_COLLECTION_COLUMNS,
  MAX_COLLECTION_CELLS,
  collectionProblem,
  collectionsProblem,
  normalizeCollection,
  collectionRows,
  collectionCellAt,
  collectionClip,
  remapCollectionsForTileset,
} from "./collection";

export {
  type ProjectSettings,
  type ProjectSettingsInput,
  type LayerTemplateEntry,
  type LayerTemplateKind,
  DEFAULT_PROJECT_SETTINGS,
  MAX_SETTINGS_TILE_SIZE,
  normalizeProjectSettings,
  projectSettingsJson,
  isHexColor,
  normalizeHexColor,
} from "./projectSettings";

export { isReservedFileName, fileNameProblem, portablePathProblem, safeFileName } from "./fileName";

export {
  type WorldPoint,
  type ProjectLevel,
  type Project,
  type PortalStatus,
  type WorldLink,
  levelIdFromPath,
  normalizeProject,
  projectLevel,
  addLevel,
  renameLevel,
  removeLevel,
  moveLevel,
  setLevelWorldPosition,
  portalTarget,
  portalTargetPoint,
  portalStatus,
  portalLabel,
  worldLinks,
} from "./project";

export {
  serializeProject,
  serializeLevel,
  parseProject,
  parseLevel,
  paletteWarnings,
  fileFormatVersion,
  type ParseLevelOptions,
  serializeClip,
  parseClip,
  serializeStamp,
  parseStamp,
  STAMP_FORMAT,
  CLIP_FORMAT,
  FormatError,
  type ProjectData,
  type LevelRef,
  PROJECT_FORMAT,
  LEVEL_FORMAT,
  PROJECT_FILE_NAME,
} from "./serialize";

export { encodeBase64, decodeBase64, encodeUint32LE, decodeUint32LE } from "./base64";

export {
  lineCells,
  rectCells,
  normalizeRect,
  brushFootprint,
  strokeCells,
  squareCorner,
  constrainRect,
  MAX_BRUSH_SIZE,
  type BrushShape,
  type CellPoint,
  type CellBounds,
  type CellRect,
} from "./geometry";

export {
  type TileGridSpec,
  type TileGrid,
  type AlphaImage,
  type AlphaScan,
  type TileGridReason,
  type TileGridSuggestion,
  type InferTileGridInput,
  type InferTileGridResult,
  COMMON_TILE_SIZES,
  MAX_GRID_SUGGESTIONS,
  inferTileGrid,
  tileSizeFromFileName,
  emptyTileIds,
  scanAlpha,
  alphaFromRgba,
  tileGridSpecProblem,
  tilesetImageExtent,
  tilesetWithGrid,
  tilesetGridRemap,
} from "./tilesetGrid";

export { floodFill, floodFillRuns, type FillRun, type CellSource } from "./fill";

export {
  copyRegion,
  pasteClip,
  cutRegion,
  flipClip,
  rotateClip,
  clipLayerPoints,
  rotateRegion,
  rotatedRect,
  clipFromTileset,
  tilesetCellsInRect,
  type TilesetCell,
  type TilesetCellRect,
  type ClipFromTilesetOptions,
  type TileClip,
  type ClipLayer,
  type LayerMapping,
  type PasteOptions,
} from "./clip";

export {
  EXPORT_FLIP_H,
  EXPORT_FLIP_V,
  EXPORT_FLIP_D,
  type ExportImage,
  type ExportWarning,
  type ExportCell,
  type ExportResult,
  type ExportLayerOptions,
  type ExportLayerSummary,
  type GameExportOptions,
  exportLayerSummaries,
  exportedLayers,
  exportedTilesets,
  layerCells,
  tilesetImageSize,
  exportBaseName,
  exportWarnings,
  GAME_EXPORT_VERSION,
  UNITY_MAP_EXTENSION,
  GAME_CELL_STRIDE,
  exportGameJson,
  exportUnityMap,
  TMJ_VERSION,
  TMJ_TILED_VERSION,
  type TmjOptions,
  type TmjResult,
  tmjFirstGids,
  exportTmj,
  type DrawItem,
  type DrawLayer,
  type DrawList,
  layerDrawList,
  encodeRle,
  decodeRle,
} from "./export";

export { rectangleBand, rectangleBandContains } from "./rectangleBand";
export { planTileReplacement, type TileReplacementOptions, type TileReplacementWrites } from "./replaceTiles";

export {
  type StampNineSlice,
  stampNineSliceProblem,
  normalizeStampNineSlice,
} from "./stamp";

export {
  NINE_SLICE_LAYOUT_VERSION,
  type NineSliceOrientation,
  type NineSliceLayout,
  type NineSliceSample,
  type NineSlicePixelRect,
  type NineSliceBlit,
  type NineSliceInnerCorner,
  assertOrientation,
  composeOrientation,
  inverseOrientation,
  orientPoint,
  nineSliceProblem,
  nineSliceLayout,
  nineSliceRegions,
  nineSliceMaskSources,
  sampleNineSlice,
  planNineSliceRect,
  nineSliceBlits,
} from "./nineSlice";

export {
  type SmartBrushSession,
  type SmartStampWrite,
  type SmartStampLayerPlan,
  type SmartStampPlan,
  type SmartStampPlanOptions,
  type SmartStampRoadOptions,
  type SmartStampApplyResult,
  planSmartStampArea,
  planSmartStampRoad,
  applySmartStampPlan,
  applySmartStampArea,
  applySmartStampRoad,
  orthogonalBridge,
} from "./smartStamp";

export { prepareNineSliceTileset, regenerateNineSliceTileset, type PrepareNineSliceTilesetOptions, type RegenerateNineSliceTilesetOptions } from "./generatedTileset";
export { stampTilesetUsage, type StampTilesetUsage } from "./region";

export { cellHash, pickVariant } from "./hash";
export * from "./smartStamp/topology";
export * from "./smartStamp/roadProfile";
export * from "./smartStamp/roadSolver";
export type { RgbaImage } from "./tilesetPixels";
export { detectNineSliceSelection, type NineSliceSelectionInput, type NineSliceDetection } from "./smartStamp/detect";
