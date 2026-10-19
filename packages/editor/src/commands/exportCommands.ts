/** v0.4 export commands (registered next to the app commands at startup). */
import { openExportDialog } from "../export/exportStore";
import { EXPORT_TARGETS } from "../export/targetRegistry";
import { useEditorStore } from "../state/editorStore";
import { registerCommands, type Command } from "./registry";

const EXPORT_COMMANDS: Command[] = [
  {
    id: "file.export",
    title: "export.command",
    category: "file",
    enabled: () => useEditorStore.getState().project !== null,
    run: () => openExportDialog(),
  },
  ...EXPORT_TARGETS.map(target => ({
    id: `file.export.${target.id}` as const,
    title: target.commandKey,
    category: "file" as const,
    enabled: () => useEditorStore.getState().project !== null,
    run: () => openExportDialog({ target: target.id }),
  })),
];

export function registerExportCommands(): void {
  registerCommands(EXPORT_COMMANDS);
}
