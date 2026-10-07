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
} from "./tileset";

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

export { TileLayer, type LayerType, type LayerProps, layerPropsProblem } from "./layer";

export {
  MapDocument,
  type MapInfo,
  type CreateDocumentOptions,
  createDocument,
  mapInfoProblem,
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
} from "./store";

export {
  serializeProject,
  serializeLevel,
  parseProject,
  parseLevel,
  FormatError,
  type ProjectData,
  type LevelRef,
  PROJECT_FORMAT,
  LEVEL_FORMAT,
  PROJECT_FILE_NAME,
} from "./serialize";

export { encodeBase64, decodeBase64, encodeUint32LE, decodeUint32LE } from "./base64";

export { lineCells, type CellPoint } from "./geometry";
