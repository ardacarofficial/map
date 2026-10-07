/** v0.4 export commands (registered next to the app commands at startup). */
import { useExportStore } from "../export/exportStore";
import { useEditorStore } from "../state/editorStore";
import { registerCommands, type Command } from "./registry";

const EXPORT_COMMANDS: Command[] = [
  {
    id: "file.export",
    title: "export.command",
    category: "file",
    enabled: () => useEditorStore.getState().project !== null,
    run: () => useExportStore.getState().setOpen(true),
  },
];

export function registerExportCommands(): void {
  registerCommands(EXPORT_COMMANDS);
}
