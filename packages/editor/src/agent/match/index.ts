/** v2.2 reference matching (pure, no DOM): K1 alignment, K3 tile index + cell matcher, K4 aligned quantization. */
export { blockScale, boxSample, cellCovered, cellHeightPx, detectAlignment, gridPeriod, pictureContent, sampleCell, samplePatch, type DetectOptions, type DetectResult } from "./alignment";
export { estimateLight, matchCell, matchResampled, preparePatch, type CellMatch, type Light, type MatchOptions } from "./matchCell";
export { quantizeAligned, type AlignedCell, type AlignedQuantizeInput } from "./quantize";
export { buildTileIndex, resample, type IndexedTile, type Resampled, type TileIndex, type TileRef, type TileSource } from "./tileIndex";
