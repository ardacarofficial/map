import { SmartGridDialog } from "./toolOptions/SmartGridDialog";
/**
 * React panels (toolbar, layers, tileset, properties, status bar).
 * Tile data never lives in React state; panels send commands to the
 * core `MapStore` and listen for its changes.
 */
import { lazy, Suspense, useEffect, useState } from "react";

import { installGlobalShortcuts } from "../commands/globalShortcuts";
import { installSession } from "../io/session";
import { useEditorStore } from "../state/editorStore";
import { CommandPalette } from "./dialogs/CommandPalette";
import { ReplaceTilesDialog } from "./dialogs/ReplaceTilesDialog";
import { NewProjectDialog } from "./dialogs/NewProjectDialog";
import { ProjectSettingsDialog } from "./projectSettings/ProjectSettingsDialog";
import { UnsavedDialog } from "./dialogs/UnsavedDialog";
import { MapSettingsDialog } from "./mapSettings/MapSettingsDialog";
import { BackupsDialog } from "./dialogs/BackupsDialog";
import { DiskChangedDialog } from "./dialogs/DiskChangedDialog";
import { useExportStore } from "../export/exportStore";
import { EntityTypesDialog } from "./entities/EntityTypesDialog";
import { SaveStampDialog } from "./stamps/SaveStampDialog";
import { installLayerSync } from "../commands/layerSync";
import { installLevelActions } from "../commands/levelActions";
import { installWorldActions } from "../commands/worldActions";
import { installTilesetActions } from "../commands/tilesetActions";
import { TilesetImportDialog } from "./tilesetImport/TilesetImportDialog";
import { NewLevelDialog, RemoveLevelDialog } from "./levels/LevelDialogs";
import { FileDropOverlay } from "./FileDropOverlay";
import { EditorLayout } from "./layout/EditorLayout";
import { EditorSkeleton } from "./layout/EditorSkeleton";
import { TooltipProvider } from "./primitives/Tooltip";
import { Toaster } from "./toast/Toaster";
import { useUiStore } from "./uiStore";
import { WelcomeScreen } from "./welcome/WelcomeScreen";

/** The export dialog (and its preview code) loads on first open: it is not needed to start drawing. */
const ExportDialog = lazy(() => import("../export/ExportDialog").then((m) => ({ default: m.ExportDialog })));

function LazyExportDialog() {
  const open = useExportStore((s) => s.open);
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  return wanted ? (
    <Suspense fallback={null}>
      <ExportDialog />
    </Suspense>
  ) : null;
}

export function App() {
  const hasProject = useEditorStore((s) => s.project !== null);
  const startupOpening = useUiStore((s) => s.startupOpening);

  useEffect(() => {
    const uninstallShortcuts = installGlobalShortcuts();
    const uninstallSession = installSession();
    const uninstallLayerSync = installLayerSync();
    const uninstallLevelActions = installLevelActions();
    const uninstallWorldActions = installWorldActions();
    const uninstallTilesetActions = installTilesetActions();
    return () => {
      uninstallShortcuts();
      uninstallSession();
      uninstallLayerSync();
      uninstallLevelActions();
      uninstallWorldActions();
      uninstallTilesetActions();
    };
  }, []);

  return (
    <TooltipProvider>
      {hasProject ? <EditorLayout /> : startupOpening ? <EditorSkeleton /> : <WelcomeScreen />}
      <FileDropOverlay />
      <CommandPalette />
      <NewProjectDialog />
      <ReplaceTilesDialog />
      <ProjectSettingsDialog />
      <UnsavedDialog />
      <MapSettingsDialog />
      <BackupsDialog />
      <DiskChangedDialog />
      <LazyExportDialog />
      <SaveStampDialog />
      <EntityTypesDialog />
      <NewLevelDialog />
      <SmartGridDialog />
      <RemoveLevelDialog />
      <TilesetImportDialog />
      {!hasProject && <Toaster />}
    </TooltipProvider>
  );
}
