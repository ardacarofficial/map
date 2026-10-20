import { Dialog } from "../../ui/primitives/Overlays";
import { useRef, useState } from "react";
import { backdropClass, popupClass, dialogWidthL } from "../../ui/dialogs/styles";
import { dialogLayoutClass } from "../../ui/dialogs/DialogFrame";
import { useAppSettings } from "../appSettings";
import { SettingsShell } from "./SettingsShell";

/** One shared draft for category controls and the Advanced settings file. */
export function SettingsPopup() {
  const popup = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const open = useAppSettings(s => s.dialogOpen);
  const setOpen = useAppSettings(s => s.setDialogOpen);
  return <Dialog.Root open={open} onOpenChange={next => { if (!busy) setOpen(next); }}><Dialog.Portal>
    <Dialog.Backdrop className={backdropClass} />
    <Dialog.Popup ref={popup} initialFocus={() => [...(popup.current?.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="true"], .settings-narrow-category select') ?? [])].find(element => element.getClientRects().length > 0) ?? popup.current} className={`${popupClass} ${dialogWidthL} ${dialogLayoutClass} settings-dialog`}>
      {open && <SettingsShell onBusyChange={setBusy} onDone={() => setOpen(false)} />}
    </Dialog.Popup>
  </Dialog.Portal></Dialog.Root>;
}
