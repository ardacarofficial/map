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
import { ExportDialog } from "../export/ExportDialog";
import { EntityTypesDialog } from "./entities/EntityTypesDialog";
import { SaveStampDialog } from "./stamps/SaveStampDialog";
import { installLayerSync } from "../commands/layerSync";
import { installLevelActions } from "../commands/levelActions";
import { NewLevelDialog, RemoveLevelDialog } from "./levels/LevelDialogs";
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
    const uninstallLevelActions = installLevelActions();
    return () => {
      uninstallShortcuts();
      uninstallSession();
      uninstallLayerSync();
      uninstallLevelActions();
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
      <ExportDialog />
      <SaveStampDialog />
      <EntityTypesDialog />
      <NewLevelDialog />
      <RemoveLevelDialog />
      <Toaster />
    </TooltipProvider>
  );
}
