/**
 * Hand tool (H): a left drag pans the map. Unlike the other tools it also
 * works in the world map view (v1.2), so it is registered here instead of
 * with the map-edit tools in `appCommands.ts`. The canvas implements it
 * (`canvas/pointerInput.ts`: grab cursor, left drag pans).
 */
import { useEditorStore } from "../state/editorStore";
import { registerCommands } from "./registry";

export function registerHandToolCommand(): void {
  registerCommands([
    {
      id: "tool.hand",
      title: "commands.tool.hand",
      category: "tool",
      enabled: () => useEditorStore.getState().project !== null,
      run: () => useEditorStore.getState().setTool("hand"),
    },
  ]);
}
