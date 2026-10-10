/**
 * Rulers along the canvas edges: the on/off choice lives in the layout
 * store (remembered); the canvas draws them. `view.toggleRulers` (View →
 * Cetveller) flips it.
 */
import { useEffect } from "react";

import type { CanvasHandle } from "../../canvas";
import { registerCommands } from "../../commands/registry";
import { useWorldView } from "../../commands/worldActions";
import { useEditorStore } from "../../state/editorStore";
import { watchCanvasHandle } from "../canvas/canvasHandle";
import { useLayoutStore } from "./layoutStore";

function apply(handle: CanvasHandle | null, visible: boolean): void {
  if (handle && handle.areRulersVisible() !== visible) handle.setRulersVisible(visible);
}

/** Keeps the mounted canvas' rulers in step with the stored choice (the world map has no tile coordinates: none there). */
export function useRulersSync(): void {
  const chosen = useLayoutStore((s) => s.rulersVisible);
  const world = useWorldView((s) => s.view === "world");
  const visible = chosen && !world;
  useEffect(() => watchCanvasHandle((handle) => apply(handle, visible)), [visible]);
}

let registered = false;

/** Registers `view.toggleRulers` (idempotent). */
export function registerRulerCommands(): void {
  if (registered) return;
  registered = true;
  registerCommands([
    {
      id: "view.toggleRulers",
      title: "commands.view.toggleRulers",
      category: "view",
      enabled: () => useEditorStore.getState().project !== null,
      checked: () => useLayoutStore.getState().rulersVisible,
      run: () => useLayoutStore.getState().setRulersVisible(!useLayoutStore.getState().rulersVisible),
    },
  ]);
}
