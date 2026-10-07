/**
 * React panels (toolbar, layers, tileset, properties, status bar).
 * Tile data never lives in React state; panels send commands to the
 * core `MapStore` and listen for its changes.
 */
import { useEffect } from "react";

import { installGlobalShortcuts } from "../commands/globalShortcuts";
import { installSession } from "../io/session";
import { useEditorStore } from "../state/editorStore";
import { CommandPalette } from "./dialogs/CommandPalette";
import { NewProjectDialog } from "./dialogs/NewProjectDialog";
import { UnsavedDialog } from "./dialogs/UnsavedDialog";
import { FileDropOverlay } from "./FileDropOverlay";
import { EditorLayout } from "./layout/EditorLayout";
import { TooltipProvider } from "./primitives/Tooltip";
import { Toaster } from "./toast/Toaster";
import { WelcomeScreen } from "./welcome/WelcomeScreen";

export function App() {
  const hasProject = useEditorStore((s) => s.project !== null);

  useEffect(() => {
    const uninstallShortcuts = installGlobalShortcuts();
    const uninstallSession = installSession();
    return () => {
      uninstallShortcuts();
      uninstallSession();
    };
  }, []);

  return (
    <TooltipProvider>
      {hasProject ? <EditorLayout /> : <WelcomeScreen />}
      <FileDropOverlay />
      <CommandPalette />
      <NewProjectDialog />
      <UnsavedDialog />
      <Toaster />
    </TooltipProvider>
  );
}
