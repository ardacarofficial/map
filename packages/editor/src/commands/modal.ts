import { useUiStore } from "../ui/uiStore";
import { useConfirmStore } from "../ui/dialogs/confirmStore";

/** True while any modal dialog (palette, new project, confirm) is open. */
export function modalOpen(): boolean {
  const ui = useUiStore.getState();
  return ui.paletteOpen || ui.newProjectOpen || useConfirmStore.getState().request !== null;
}
