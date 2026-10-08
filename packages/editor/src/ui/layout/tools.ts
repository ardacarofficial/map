import type { CommandId } from "../../shortcuts/shortcuts";
import type { ToolId } from "../../state/editorStore";
import type { IconName } from "../primitives/Icon";

/** The tool rail's tools, in order (also the tool chip of the options bar). */
export const TOOLS: readonly { id: ToolId; icon: IconName; command: CommandId }[] = [
  { id: "brush", icon: "pencil", command: "tool.brush" },
  { id: "eraser", icon: "eraser", command: "tool.eraser" },
  { id: "fill", icon: "fill", command: "tool.fill" },
  { id: "rect", icon: "rect", command: "tool.rect" },
  { id: "select", icon: "select", command: "tool.select" },
  { id: "eyedropper", icon: "eyedropper", command: "tool.eyedropper" },
  { id: "entity", icon: "pin", command: "tool.entity" },
];

export function toolIcon(id: ToolId): IconName {
  return TOOLS.find((tool) => tool.id === id)?.icon ?? "pencil";
}
