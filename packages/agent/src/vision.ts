/** Reference-image contracts (picture → map). No DOM; ports are implemented by the editor host. */
import type { AgentCallContext, AgentImageResult, AgentSignal, Id, Point, PreviewImage, ReadContext, Rect, Revision, Tile, Unsubscribe } from "./contracts";
import type { ProposalCell, QuantizeMode, ReferenceFit } from "./tools/quantize";

export const VISION_TOOL_NAMES = ["reference_add", "reference_view", "reference_quantize", "render_compare"] as const;
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

export interface ReferenceSummary { referenceId: Id; name: string; width: number; height: number; origin: "user" | "agent" }
export interface ReferenceAddArgs { context?: ReadContext; path?: string; imageBase64?: string; selectedReferenceToken?: string; name?: string }
interface ReferenceMapping { referenceId: Id; mapId: Id; region?: Rect; fit?: ReferenceFit; sourceRect?: Rect }
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
  preview?: boolean;
}
/** K1: where the map grid lies on a reference picture. */
export interface ReferenceAlignment {
  /** Reference pixels per map cell. */ cellPx: number;
  /** Reference px per source tile px. */ scale: number;
  /** Reference-pixel position of map cell (0,0) top-left; may be negative. */ offsetX: number; offsetY: number;
  /** Cells covered. */ cols: number; rows: number;
  confidence: number; method: "auto" | "manual";
}
export type ReferenceAlignmentChoice = "auto" | "none" | ReferenceAlignment;
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
  /** C1 multi-layer grid: pass `layers` to paint_grid (with mapId) unchanged. */
  grid: { layers: QuantizeLayerProposal[] };
  confidence: { high: number; medium: number; low: number; uncovered: number; meanError: number; lowCells: Point[]; lowCellsTruncated: boolean };
  stamps: { stampId: Id; name: string; at: Point; source: "detected" | "legend" }[];
  palette?: { hex: string; cells: number; legend?: string; ground?: ProposalCell }[];
  image?: PreviewImage;
  warnings: string[];
  mapRevision: Revision;
}
export interface ReferenceViewData { mapId: Id; referenceId: Id; region: Rect; fit: ReferenceFit; sourceRect: Rect; cellPixels: { width: number; height: number }; image: PreviewImage }
export interface RenderCompareData {
  mapId: Id; region: Rect; mode: "side" | "overlay" | "diff"; against: "reference" | "draftStart"; image: PreviewImage; mismatch: { cells: number; ratio: number; sample: Point[] }; mapRevision: Revision;
  /** Picture placement used (reference only): explicit alignment or "none" (fit/sourceRect over the whole map; region crops). */
  alignment?: ReferenceAlignment | "none"; cellPixels?: { width: number; height: number };
  /** cells:true — per-cell perceptual error (mean Lab ΔE over the cell's pixels). */
  stats?: { cells: number; meanErr: number; pctBelow: { deltaE5: number } };
  worst?: CompareWorstCell[];
  /** cells:true — heatmap panel inside the returned image (green ΔE<5 … red ≥20; worst cells numbered). */
  heatmap?: { rect: Rect };
}

export interface VisionToolArguments {
  reference_add: ReferenceAddArgs; reference_view: ReferenceViewArgs;
  reference_quantize: ReferenceQuantizeArgs; render_compare: RenderCompareArgs;
}
export interface VisionToolData {
  reference_add: ReferenceSummary; reference_view: ReferenceViewData;
  reference_quantize: ReferenceQuantizeData; render_compare: RenderCompareData;
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
  /** Last successful agent write per map (render_preview highlight:"lastCall"). */
  noteChange?(affected: readonly { mapId: Id; bounds?: Rect }[]): void;
  subscribe?(listener: () => void): Unsubscribe;
}
export type { AgentSignal };
