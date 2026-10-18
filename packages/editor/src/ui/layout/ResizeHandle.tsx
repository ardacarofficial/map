import type { ColumnId } from "./columns";
import { ZoneSplitter } from "./DockZone";
/** Compatibility name for the unified outer splitter. */
export function ResizeHandle({ column }: { column: ColumnId; edge: "left" | "right"; width: number }) {
  return <ZoneSplitter zone={column === "library" ? "left" : "right"} />;
}
