/**
 * Which context the Denetçi (inspector) shows. Pure so the rule is testable.
 *
 * First match wins (round 4 design):
 * 1. an entity is selected                → "entity"
 * 2. defining / fixing a terrain (tileset ⚙ Düzenle → Arazi) → "terrain"
 * 3. a marquee region (select tool)       → "region"
 * 4. collision layer active               → "collision"
 * 5. terrain brush on a tile layer        → "terrain"
 * 6. a paint tool (or a clip on the brush) on a tile layer → "brush"
 *    (with nothing picked the card says "Önce bir tile seç")
 * 7. otherwise                            → "map"
 */
import type { ToolId } from "../../state/editorStore";
import type { TilesetMode } from "../uiStore";

export type InspectorMode = "entity" | "region" | "brush" | "terrain" | "collision" | "map";

/** Kind of the active layer, as far as the inspector cares. */
export type LayerKind = "tile" | "collision" | "entity" | "none";

/** What the brush carries. */
export type BrushContent = "stamp" | "random" | "tile" | "none";

export interface ModeInput {
  entitySelected: boolean;
  layer: LayerKind;
  tool: ToolId;
  /** A marquee region exists. */
  region: boolean;
  brush: BrushContent;
  /** The terrain brush is on (terrain as a brush on tile layers). */
  terrainBrush?: boolean;
  /** A terrain is being defined or fixed in the tileset (⚙ Düzenle → Arazi). */
  terrainEdit?: boolean;
}

/** The dock mode opens terrain editing even before a draft or fix exists. */
export function terrainEditActive(tilesetMode: TilesetMode, definingOrFixing: boolean): boolean {
  return tilesetMode === "terrain" || definingOrFixing;
}

/** Tools that put the brush on the map. */
export const PAINT_TOOLS: readonly ToolId[] = ["brush", "eraser", "fill", "rect"];

export function inspectorMode(input: ModeInput): InspectorMode {
  if (input.entitySelected) return "entity";
  if (input.terrainEdit === true) return "terrain";
  if (input.region && input.tool === "select" && input.layer !== "entity") return "region";
  if (input.layer === "collision") return "collision";
  if (input.terrainBrush === true && input.layer === "tile" && PAINT_TOOLS.includes(input.tool)) return "terrain";
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
