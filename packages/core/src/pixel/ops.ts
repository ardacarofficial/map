import type { Tileset } from "../tileset";
import type { CellWrite } from '../ops';
import type { RasterAssetInput } from './assets';
export interface PixelDirtyRect {
  readonly assetId: string;
  readonly tileId: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface PixelRectPatch extends PixelDirtyRect {
  readonly before: Uint8Array;
  readonly after: Uint8Array;
}
export interface EditTilePixelsOp extends PixelDirtyRect {
  readonly type: 'editTilePixels';
  readonly after: Uint8Array;
  /** Optional optimistic concurrency guard; compared before any mutation. */
  readonly before?: Uint8Array;
}
export interface AllocateEditedTileOp {
  readonly type: 'allocateEditedTile';
  /** Initial display name supplied by the caller. Existing atlas names are preserved. */
  readonly name?: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly pixels: Uint8Array;
  readonly source?: { readonly tilesetId: string; readonly tileId: number; readonly pixelHash: string };
}
export interface EditedTileSlot { readonly assetId: string; readonly tileId: number; readonly paletteIndex: number }
/** Remap explicit owner cells, retaining their H/V/D flags. Locked layers ignore valid writes. */
export interface RemapCellsOp {
  readonly type: 'remapCells';
  readonly layerId: string;
  readonly cells: readonly Pick<CellWrite, 'x' | 'y'>[];
  readonly tilesetId: string;
  readonly tileId: number;
}
/** Seed a decoded persisted raster. Nonundoable, only before local history/transactions. */
export interface LoadRasterAssetOp { readonly type: 'loadRasterAsset'; readonly asset: RasterAssetInput }
/** A batch validates every rect against the initial raster before writing any rect. Overlap is rejected. */
export interface PatchPixelsOp { readonly type: 'patchPixels'; readonly patches: readonly PixelRectPatch[] }
/** Synchronize metadata in participant maps; shared raster patches are applied by their owning store only. */
export interface SetEditedTilesetOp { readonly type: 'setEditedTileset'; readonly tileset: Tileset }
export type PixelOp = SetEditedTilesetOp | AllocateEditedTileOp | EditTilePixelsOp | RemapCellsOp | LoadRasterAssetOp | PatchPixelsOp;
