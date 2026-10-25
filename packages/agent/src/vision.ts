/** Reference-image contracts (picture → map). No DOM; ports are implemented by the editor host. */
import type { AgentCallContext, AgentImageResult, AgentSignal, Id, Point, PreviewImage, ReadContext, Rect, Revision, Tile, Unsubscribe } from "./contracts";
import type { ProposalCell, QuantizeMode, ReferenceFit } from "./tools/quantize";

export const VISION_TOOL_NAMES = ["reference_add", "reference_view", "reference_quantize", "render_compare", "reference_align"] as const;
export type VisionToolName = typeof VISION_TOOL_NAMES[number];
export const REFERENCE_LIMITS = {
  /** Encoded file size for path/base64 intake. */
  fileBytes: 16 * 1024 * 1024,
  /** Decoded references are downscaled to fit these bounds. */
  side: 2048, pixels: 4194304,
  references: 32, retainedBytes: 64 * 1024 * 1024,
  extensions: [".png", ".jpg", ".jpeg", ".webp"],
  quantizeCells: 65536, legendColors: 32, candidateTiles: 1024,
} as const;

/** K1: how a reference picture lies on a map's cell grid (memory only, per referenceId + mapId). */
export interface ReferenceAlignment {
  /** Reference pixels per map cell (horizontal). */
  cellPx: number;
  /** Vertical reference pixels per map cell when cells are not scale × tileHeight (stretched fits). */
  cellPxY?: number;
  /** Reference pixels per source tile pixel. */
  scale: number;
  /** Reference-pixel position of map cell (0,0)'s top-left; may be negative. */
  offsetX: number; offsetY: number;
  /** Map cells covered from cell 0 (a cell counts when its centre lies on the picture). */
  cols: number; rows: number;
  confidence: number;
  method: "auto" | "manual";
}
/** "auto": saved alignment or detection (whole-map fit when unsure); "none": picture fitted onto the whole map (fit/sourceRect). A region always crops the same cells. */
export type ReferenceAlignmentInput = Pick<ReferenceAlignment, "cellPx" | "offsetX" | "offsetY"> & Partial<ReferenceAlignment>;
export type ReferenceAlignmentChoice = "auto" | "none" | ReferenceAlignmentInput;
export interface ReferenceAlignHint { scale?: number; offsetX?: number; offsetY?: number; cellPx?: number }
export interface ReferenceAlignArgs { context?: ReadContext; referenceId: Id; mapId: Id; hint?: ReferenceAlignHint; save?: boolean; maxSide?: number }
/** image: the picture (scale = preview px per picture px) with the detected cell grid; cell (0,0) outlined. */
export interface ReferenceAlignData { mapId: Id; referenceId: Id; alignment: ReferenceAlignment; saved: boolean; content: Rect; image: { width: number; height: number; scale: number }; warnings: string[] }
export interface ReferenceSummary { referenceId: Id; name: string; width: number; height: number; origin: "user" | "agent" }
export interface ReferenceAddArgs { context?: ReadContext; path?: string; imageBase64?: string; selectedReferenceToken?: string; name?: string }
interface ReferenceMapping { referenceId: Id; mapId: Id; region?: Rect; fit?: ReferenceFit; sourceRect?: Rect; alignment?: ReferenceAlignmentChoice }
export interface ReferenceViewArgs extends ReferenceMapping { context?: ReadContext; grid?: boolean; coordinates?: boolean; maxSide?: number; zoom?: number }
/** Colour legend value: a C1 cell, a tag word, a stamp or an overlay tile. */
/** {random} keeps natural variation: the proposal legend gets the same random entry (hash(seed,x,y) when painted). */
export type LegendRandom = { random: (Tile & { weight?: number })[]; seed?: number };
export type ColorLegendValue = Tile | null | "keep" | string | LegendRandom | { stampId: Id; ground?: Tile | null | LegendRandom } | { overlay: Tile; ground?: Tile | null | LegendRandom };
export interface ReferenceQuantizeArgs extends ReferenceMapping {
  context?: ReadContext;
  mode?: "auto" | QuantizeMode;
  candidates?: { tilesetIds?: Id[]; tiles?: Tile[]; stamps?: Id[] };
  layers?: { ground?: Id; overlay?: Id | null };
  colorLegend?: Record<string, ColorLegendValue>;
  /** Per-cell light normalization (default true). */
  normalizeLight?: boolean;
  preview?: boolean;
}
export interface RenderCompareArgs { context?: ReadContext; mapId: Id; referenceId?: Id; baseline?: "draftStart"; mode?: "side" | "overlay" | "diff"; region?: Rect; fit?: ReferenceFit; sourceRect?: Rect; alignment?: ReferenceAlignmentChoice; cells?: boolean; maxSide?: number; layerIds?: Id[] }
/** One badly matching cell (render_compare cells:true); alternatives are only suggestions for the agent. */
export interface CompareWorstCell { x: number; y: number; err: number; current: { layerId: Id; tile: Tile }[]; alternatives: { tile: Tile; overlay?: Tile; err: number }[] }

export interface QuantizeLayerProposal { layerId: Id; layerName: string; origin: Point; rows: string[]; legend: Record<string, ProposalCell | LegendRandom>; counts: Record<string, number> }
export interface ReferenceQuantizeData {
  /** paint_grid {proposalId} paints grid.layers unchanged (no retyping). */
  proposalId?: Id;
  mapId: Id; referenceId: Id; region: Rect; mode: QuantizeMode; fit: ReferenceFit; sourceRect: Rect;
  /** Reference pixels per map cell. */
  cellPixels: { width: number; height: number };
  /** Grid alignment used (null: picture fitted onto the region). */
  alignment?: ReferenceAlignment | null;
  /** exactish: % of covered cells whose best match error is ≤ 6 ΔE; meanErr in ΔE. */
  stats?: { exactish: number; meanErr: number };
  /** C1 multi-layer grid: pass `layers` to paint_grid (with mapId) unchanged. */
  grid: { layers: QuantizeLayerProposal[] };
  confidence: { high: number; medium: number; low: number; uncovered: number; meanError: number; lowCells: Point[]; lowCellsTruncated: boolean };
  stamps: { stampId: Id; name: string; at: Point; source: "detected" | "legend" }[];
  palette?: { hex: string; cells: number; legend?: string; ground?: ProposalCell }[];
  image?: PreviewImage;
  warnings: string[];
  mapRevision: Revision;
}
export interface ReferenceViewData { mapId: Id; referenceId: Id; region: Rect; fit: ReferenceFit; sourceRect: Rect; cellPixels: { width: number; height: number }; alignment?: ReferenceAlignment | null; warnings?: string[]; image: PreviewImage }
export interface RenderCompareData {
  mapId: Id; region: Rect; mode: "side" | "overlay" | "diff"; against: "reference" | "draftStart"; image: PreviewImage; mismatch: { cells: number; ratio: number; sample: Point[] }; mapRevision: Revision;
  /** Grid used (reference only): the alignment, or null when the picture was fitted onto the whole map (none / unsure). */
  alignment?: ReferenceAlignment | null; cellPixels?: { width: number; height: number }; warnings?: string[];
  /** cells:true — per-cell perceptual error (mean Lab ΔE after fitting the picture light per cell). */
  stats?: { cells: number; meanErr: number; pctBelow: { deltaE5: number } };
  worst?: CompareWorstCell[];
  /** cells:true — heatmap panel inside the returned image (green ΔE<5 … red ≥20; worst cells numbered). */
  heatmap?: { rect: Rect };
}

export interface VisionToolArguments {
  reference_add: ReferenceAddArgs; reference_view: ReferenceViewArgs;
  reference_quantize: ReferenceQuantizeArgs; render_compare: RenderCompareArgs; reference_align: ReferenceAlignArgs;
}
export interface VisionToolData {
  reference_add: ReferenceSummary; reference_view: ReferenceViewData;
  reference_quantize: ReferenceQuantizeData; render_compare: RenderCompareData; reference_align: ReferenceAlignData;
}
/** Resolved legend entry handed to the host (tag words and stamps already resolved). */
export interface ResolvedLegendEntry { hex: string; label: string; cell?: ProposalCell; overlay?: ProposalCell; stampId?: Id }
export interface ResolvedStampProbe { stampId: Id; name: string; width: number; height: number; cells: { x: number; y: number; tile: Required<Tile> }[] }
export interface ReferenceQuantizeRequest extends ReferenceQuantizeArgs { legend: ResolvedLegendEntry[]; probes: ResolvedStampProbe[]; groundLayer: { id: Id; name: string }; overlayLayer: { id: Id; name: string } | null }
export type ReferenceImageResult<T> = { data: T; image?: AgentImageResult };
/** World-scoped reference library: user drops/pastes and agent-added images, never written anywhere. */
export interface AgentReferencePort {
  list(): ReferenceSummary[];
  add(args: ReferenceAddArgs, call: AgentCallContext): Promise<ReferenceSummary>;
  view(args: ReferenceViewArgs, call: AgentCallContext): Promise<ReferenceImageResult<ReferenceViewData>>;
  quantize(args: ReferenceQuantizeRequest, call: AgentCallContext): Promise<ReferenceImageResult<ReferenceQuantizeData>>;
  compare(args: RenderCompareArgs, call: AgentCallContext): Promise<ReferenceImageResult<RenderCompareData>>;
  align?(args: ReferenceAlignArgs, call: AgentCallContext): Promise<ReferenceImageResult<ReferenceAlignData>>;
  /** Last successful agent write per map (render_preview highlight:"lastCall"). */
  noteChange?(affected: readonly { mapId: Id; bounds?: Rect }[]): void;
  subscribe?(listener: () => void): Unsubscribe;
}
export type { AgentSignal };
