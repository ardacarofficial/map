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
import { BackupsDialog } from "./dialogs/BackupsDialog";
import { DiskChangedDialog } from "./dialogs/DiskChangedDialog";
import { ResizeMapDialog } from "./dialogs/ResizeMapDialog";
import { installLayerSync } from "../commands/layerSync";
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
    const uninstallLayerSync = installLayerSync();
    return () => {
      uninstallShortcuts();
      uninstallSession();
      uninstallLayerSync();
    };
  }, []);

  return (
    <TooltipProvider>
      {hasProject ? <EditorLayout /> : <WelcomeScreen />}
      <FileDropOverlay />
      <CommandPalette />
      <NewProjectDialog />
      <UnsavedDialog />
      <ResizeMapDialog />
      <BackupsDialog />
      <DiskChangedDialog />
      <Toaster />
    </TooltipProvider>
  );
}
