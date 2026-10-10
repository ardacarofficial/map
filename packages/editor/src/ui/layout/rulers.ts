/**
 * Rulers along the canvas edges: the on/off choice lives in the layout
 * store (remembered); the canvas draws them. `view.toggleRulers` (View →
 * Cetveller) flips it.
 */
import { useEffect } from "react";

import { registerCommands } from "../../commands/registry";
import { useEditorStore } from "../../state/editorStore";
import { watchCanvasHandle } from "../canvas/canvasHandle";
import { useLayoutStore } from "./layoutStore";

import type { CanvasHandle } from "../../canvas";

function apply(handle: CanvasHandle | null, visible: boolean): void {
  if (handle && handle.areRulersVisible() !== visible) handle.setRulersVisible(visible);
}

/** Keeps the mounted canvas' rulers in step with the stored choice. */
export function useRulersSync(): void {
  const visible = useLayoutStore((s) => s.rulersVisible);
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
