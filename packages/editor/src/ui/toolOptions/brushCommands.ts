/** The `[` / `]` commands (keys in shortcuts.ts). */
import { registerCommands } from "../../commands/registry";
import { isWorldView } from "../../commands/worldActions";
import { useEditorStore } from "../../state/editorStore";
import { stepBrushSize } from "./brushSize";

export function changeBrushSize(dir: 1 | -1): void {
  const state = useEditorStore.getState();
  state.setBrushSize(stepBrushSize(state.brushSize, dir));
}

let registered = false;

/** `brush.smaller` / `brush.larger` (keys in shortcuts.ts). Idempotent. */
export function registerBrushCommands(): void {
  if (registered) return;
  registered = true;
  const enabled = () => useEditorStore.getState().project !== null && !isWorldView();
  registerCommands([
    { id: "brush.smaller", title: "toolOptions.brushSmaller", category: "tool", enabled, run: () => changeBrushSize(-1) },
    { id: "brush.larger", title: "toolOptions.brushLarger", category: "tool", enabled, run: () => changeBrushSize(1) },
  ]);
}
