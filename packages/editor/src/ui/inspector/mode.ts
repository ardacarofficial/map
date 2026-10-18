import type { ToolId } from "../../state/editorStore";

export type InspectorMode = "entity" | "stamp" | "region" | "brush" | "collision" | "map";

/** Kind of the active layer, as far as the inspector cares. */
export type LayerKind = "tile" | "collision" | "entity" | "none";

/** What the brush carries. */
export type BrushContent = "stamp" | "random" | "tile" | "none";

export interface ModeInput {
  entitySelected: boolean;
  libraryStamp?: boolean;
  layer: LayerKind;
  tool: ToolId;
  /** A marquee region exists. */
  region: boolean;
  brush: BrushContent;

}

/** Tools that put the brush on the map. */
export const PAINT_TOOLS: readonly ToolId[] = ["brush", "eraser", "fill", "rect"];

export function inspectorMode(input: ModeInput): InspectorMode {
  if (input.entitySelected) return "entity";
  if (input.region && input.tool === "select" && input.layer !== "entity") return "region";
  if (input.layer === "collision") return "collision";
  // A random set on the brush keeps its card (its candidate list) over a selected library stamp.
  if (input.libraryStamp === true && input.brush !== "random") return "stamp";
  if (input.layer === "tile") {
    // A clip on the brush (paste, stamp) is placed by the brush whatever tool was active before.
    if (input.brush === "stamp") return "brush";
    if (PAINT_TOOLS.includes(input.tool)) return "brush";
  }
  return "map";
}

/** What the brush carries, from the editor state's fields. */
export function brushContent(state: { stamp: unknown; randomSet: readonly unknown[]; selection: unknown }): BrushContent {
  if (state.stamp) return "stamp";
  if (state.randomSet.length >= 2) return "random";
  if (state.selection) return "tile";
  return "none";
}
