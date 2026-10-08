import { useSaveStatus } from "../io/saveStatus";
import { useUiStore } from "../ui/uiStore";
import { useConfirmStore } from "../ui/dialogs/confirmStore";
import { useExportStore } from "../export/exportStore";
import { useLevelUi } from "./levelActions";
import { useAppSettings } from "../platform/appSettings";
import { tilesetCardOpen } from "../ui/tilesetImport/importStore";

/** True while any modal dialog (palette, new project, resize, backups, confirm, disk changed) is open. */
export function modalOpen(): boolean {
  const ui = useUiStore.getState();
  return (
    ui.paletteOpen ||
    ui.newProjectOpen ||
    ui.resizeOpen ||
    ui.backupsOpen ||
    useExportStore.getState().open ||
    useConfirmStore.getState().request !== null ||
    useLevelUi.getState().newLevelOpen ||
    useLevelUi.getState().removeLevelId !== null ||
    useSaveStatus.getState().diskConflict !== null ||
    useAppSettings.getState().dialogOpen ||
    tilesetCardOpen()
  );
}
