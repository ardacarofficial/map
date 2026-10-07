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
} from "./cell";

export { Palette, type PaletteEntry } from "./palette";

export {
  type Tileset,
  type TileRect,
  tileCount,
  tileIdAt,
  tilePosition,
  tileRect,
  isValidTileId,
  gridCount,
  tilesetProblem,
  relativePathProblem,
  isTileSolid,
  normalizeTileset,
} from "./tileset";

export {
  type Terrain,
  type TerrainTemplate,
  type TerrainTemplateInfo,
  type TerrainVariant,
  TERRAIN_TEMPLATES,
  MAX_TERRAIN_ID,
  CORNER_NE,
  CORNER_SE,
  CORNER_SW,
  CORNER_NW,
  BLOB_N,
  BLOB_NE,
  BLOB_E,
  BLOB_SE,
  BLOB_S,
  BLOB_SW,
  BLOB_W,
  BLOB_NW,
  BLOB47_MASKS,
  reduceBlobMask,
  blob47Slot,
  corner16Slot,
  isTerrainTemplate,
  terrainSlotTileId,
  terrainCandidates,
  terrainProblem,
  normalizeTerrain,
  cellHash,
  pickVariant,
} from "./terrain";

export {
  type TerrainSlot,
  TerrainTiles,
  terrainSlotAt,
  terrainTileAt,
  deriveTerrainTiles,
} from "./autotile";

export { type CollisionGrid, collisionAt, deriveCollision, solidPaletteMask } from "./collision";

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
  isGridLayer,
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
  createDocument,
  mapInfoProblem,
  isValidSeed,
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
  PaintTerrainOp,
  SetTileSolidOp,
  DefineTerrainOp,
  RemoveTerrainOp,
  GridWrite,
  NewLayer,
  CellWrite,
  CellChange,
  LayerPatch,
} from "./ops";

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
} from "./store";

export {
  serializeProject,
  serializeLevel,
  parseProject,
  parseLevel,
  serializeClip,
  parseClip,
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
  type CellPoint,
  type CellBounds,
  type CellRect,
} from "./geometry";

export { floodFill, type CellSource } from "./fill";

export {
  copyRegion,
  pasteClip,
  cutRegion,
  flipClip,
  clipLayerPoints,
  type TileClip,
  type ClipLayer,
  type LayerMapping,
  type PasteOptions,
} from "./clip";
