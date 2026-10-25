/** Object tools (v2.2, K5/K6): find stamps in a reference picture, suggest stamp candidates from a tileset sheet.
 * Read-only. No DOM; the editor host implements {@link AgentObjectsPort}. */
import type { AgentCallContext, Id, Point, PreviewImage, ReadContext, Rect, Revision } from "./contracts";
import type { ReferenceAlignment, ReferenceAlignmentChoice, ReferenceImageResult } from "./vision";

export const OBJECT_TOOL_NAMES = ["reference_detect_objects", "suggest_stamps"] as const;
export type ObjectToolName = typeof OBJECT_TOOL_NAMES[number];
export const OBJECT_LIMITS = {
  /** Stamps searched per call. */
  stamps: 64,
  /** Largest stamp side (cells) used as a template. */
  stampSide: 16,
  /** Matches reported per call. */
  matches: 256,
  /** Map-pixel working image the picture is resampled to. */
  workPixels: 8 * 1024 * 1024,
  /** Candidates reported by suggest_stamps. */
  candidates: 64,
  /** Largest candidate object (tiles per side / tiles in total). */
  candidateSide: 12, candidateTiles: 96,
} as const;

/** "auto" (default): stored alignment or detection; "none": the trimmed picture fitted onto the map; or reference_align's alignment. */
export type ReferenceAlignmentArg = ReferenceAlignmentChoice;

export interface DetectObjectsArgs { context?: ReadContext; referenceId: Id; mapId: Id; stampIds?: Id[]; minScore?: number; alignment?: ReferenceAlignmentArg; preview?: boolean }
export interface DetectObjectsRequest extends DetectObjectsArgs { stampIds: Id[] }
export interface ObjectMatch {
  stampId: Id;
  /** Top-left map cell (place_stamp at/positions). */
  x: number; y: number;
  /** 0..1 masked appearance similarity on the visible part. */
  score: number;
  /** Object top-left minus the cell's top-left, in map pixels (a misaligned picture or an off-grid object). */
  pixelResidual: { dx: number; dy: number };
}
export interface DetectObjectsData {
  mapId: Id; referenceId: Id;
  alignment: ReferenceAlignment;
  /** Box n in the preview is matches[n-1]. */
  matches: ObjectMatch[];
  /** Ready for place_stamp {stampId, positions}. */
  positionsByStamp: Record<Id, [number, number][]>;
  truncated: boolean;
  warnings: string[];
  image?: PreviewImage;
  mapRevision: Revision;
}

export interface SuggestStampsArgs { context?: ReadContext; tilesetId: Id; region?: Rect; minTiles?: number }
export interface StampCandidate {
  /** Number printed on the preview sheet. */
  n: number;
  /** Tileset sheet cells: pass as create_stamp {source:{tilesetId, region}}. */
  region: Rect;
  /** Non-empty tiles, row-major within region. */
  tileIds: number[];
  /** Non-empty tiles of other objects inside region (create_stamp would include them). */
  otherTiles?: number;
  /** A stamp with exactly these tiles already exists. */
  existingStampId?: Id;
}
export interface SuggestStampsData {
  tilesetId: Id;
  candidates: StampCandidate[];
  truncated: boolean;
  /** Connected parts left out: tooLarge (above 12×12 / 96 tiles) or opaque (only fully opaque tiles: terrain). */
  skipped: { tooLarge: number; opaque: number };
  image?: { width: number; height: number; scale: number; contentRect: Rect; origin: Point };
}

export interface ObjectToolArguments { reference_detect_objects: DetectObjectsArgs; suggest_stamps: SuggestStampsArgs }
export interface ObjectToolData { reference_detect_objects: DetectObjectsData; suggest_stamps: SuggestStampsData }

export interface AgentObjectsPort {
  detect(args: DetectObjectsRequest, call: AgentCallContext): Promise<ReferenceImageResult<DetectObjectsData>>;
  suggest(args: SuggestStampsArgs, call: AgentCallContext): Promise<ReferenceImageResult<SuggestStampsData>>;
}
