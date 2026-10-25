export * from "./contracts";
export * from "./toolSchemas";
export { createAgentApi } from "./api";
export { TOOL_CATALOGUE_HASH } from "./catalogue.generated";

export { toMcpToolResult } from "./result";
export {
  createMemoryHost,
  memoryCall,
  MemoryClock,
} from "./testing/memoryHost";
export type { MemoryHost, MemoryHostOptions } from "./testing/memoryHost";
export { CallSignal } from "./transactions";
export {
  parseTags,
  serializeTags,
  emptyTags,
  normalizeTags,
  tileFingerprint,
  stampFingerprint,
  hashCanonical,
  semanticMatches,
} from "./tags";

export * from "./tools/visual";
export * from "./vision";
export * from "./objects";
export { quantizeReference, autoTrim, looksLikeSketch, referencePlacement, parseHexColor, tilePatch, QUANTIZE_PATCH, encodeLayer, detectStampProbes, summarizeConfidence, tileKey } from "./tools/quantize";
export type { ProposalCell, QuantizeMode, ReferenceFit, QuantizeCandidate, QuantizeOutput, ColorLegendEntry, StampProbe, CellResult } from "./tools/quantize";
export { REFERENCE_VIEW_DEFAULTS } from "./tools/vision";

export * from "./editorControls";

export type { RegionClaim, CollaborationMemberSummary, CollaborationSummary, CollaborativeBegin, CollaborativeJoin } from "./collaboration";
