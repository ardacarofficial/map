import { usePixelUi } from "../../state/pixelUi";
/** The `[` / `]` commands (keys in shortcuts.ts). */
import { registerCommands } from "../../commands/registry";
import { isWorldView } from "../../commands/worldActions";
import { useEditorStore } from "../../state/editorStore";
import { stepBrushSize } from "./brushSize";

export function changeBrushSize(dir: 1 | -1): void {
  const pixel = usePixelUi.getState();
  if (pixel.mode === "pixel") { pixel.setSize(pixel.size + dir); return; }
  const state = useEditorStore.getState();
  state.setBrushSize(stepBrushSize(state.brushSize, dir));
}

let registered = false;

/** `brush.smaller` / `brush.larger` (keys in shortcuts.ts). Idempotent. */
export function registerBrushCommands(): void {
  if (registered) return;
  registered = true;
  // Only the brush and the eraser have a size.
  const enabled = () => {
    const s = useEditorStore.getState();
    return s.project !== null && !isWorldView() && (s.tool === "brush" || s.tool === "eraser" || (usePixelUi.getState().mode === "pixel" && s.tool === "line"));
  };
  registerCommands([
    { id: "brush.smaller", title: "toolOptions.brushSmaller", category: "tool", enabled, run: () => changeBrushSize(-1) },
    { id: "brush.larger", title: "toolOptions.brushLarger", category: "tool", enabled, run: () => changeBrushSize(1) },
  ]);
}
