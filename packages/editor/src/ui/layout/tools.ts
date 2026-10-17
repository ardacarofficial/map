import type { CommandId } from "../../shortcuts/shortcuts";
import type { ToolId } from "../../state/editorStore";
import type { IconName } from "../primitives/Icon";

/** The rail's tools, in order; `group` starts a new group (small gap + divider). */
export const TOOLS: readonly { id: ToolId; icon: IconName; command: CommandId; group?: true }[] = [
  { id: "select", icon: "square-dashed", command: "tool.select" },
  { id: "hand", icon: "hand", command: "tool.hand" },
  { id: "brush", icon: "pencil", command: "tool.brush", group: true },
  { id: "eraser", icon: "eraser", command: "tool.eraser" },
  { id: "fill", icon: "paint-bucket", command: "tool.fill" },
  { id: "rect", icon: "square", command: "tool.rect" },
  { id: "eyedropper", icon: "pipette", command: "tool.eyedropper", group: true },
  { id: "entity", icon: "box", command: "tool.entity", group: true },
];

export function toolIcon(id: ToolId): IconName {
  return TOOLS.find((tool) => tool.id === id)?.icon ?? "pencil";
}
