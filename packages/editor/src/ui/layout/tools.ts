import type { CommandId } from "../../shortcuts/shortcuts";
import type { ToolId } from "../../state/editorStore";
import type { IconName } from "../primitives/Icon";

/** The tool bar's tools, in order; `group` starts a new group (small gap + divider). */
export const TOOLS: readonly { id: ToolId; icon: IconName; command: CommandId; group?: true }[] = [
  { id: "select", icon: "select", command: "tool.select" },
  { id: "brush", icon: "pencil", command: "tool.brush", group: true },
  { id: "eraser", icon: "eraser", command: "tool.eraser" },
  { id: "fill", icon: "fill", command: "tool.fill" },
  { id: "rect", icon: "rect", command: "tool.rect" },
  { id: "eyedropper", icon: "eyedropper", command: "tool.eyedropper", group: true },
  { id: "entity", icon: "pin", command: "tool.entity" },
  { id: "hand", icon: "hand", command: "tool.hand" },
];

export function toolIcon(id: ToolId): IconName {
  return TOOLS.find((tool) => tool.id === id)?.icon ?? "pencil";
}
