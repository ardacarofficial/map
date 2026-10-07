import { useSaveStatus } from "../io/saveStatus";
import { useUiStore } from "../ui/uiStore";
import { useConfirmStore } from "../ui/dialogs/confirmStore";

/** True while any modal dialog (palette, new project, resize, backups, confirm, disk changed) is open. */
export function modalOpen(): boolean {
  const ui = useUiStore.getState();
  return (
    ui.paletteOpen ||
    ui.newProjectOpen ||
    ui.resizeOpen ||
    ui.backupsOpen ||
    useConfirmStore.getState().request !== null ||
    useSaveStatus.getState().diskConflict !== null
  );
}
