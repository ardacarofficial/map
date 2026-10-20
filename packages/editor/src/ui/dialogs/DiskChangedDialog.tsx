import { useRef } from "react";
import { AlertDialog } from "../primitives/Overlays";
import { t } from "../../i18n";
import { keepMine, reloadFromDisk } from "../../io/session";
import { useSaveStatus } from "../../io/saveStatus";
import { Button } from "../primitives/Button";
import { DialogHeader, DialogFooter, dialogLayoutClass } from "./DialogFrame";
import { backdropClass, popupClass, dialogWidthS } from "./styles";

export function DiskChangedDialog() {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const conflict = useSaveStatus(s => s.diskConflict);
  return <AlertDialog.Root open={conflict !== null} onOpenChange={open => !open && conflict && keepMine()}>
    <AlertDialog.Portal><AlertDialog.Backdrop className={backdropClass} />
      <AlertDialog.Popup initialFocus={primaryRef} className={`${popupClass} ${dialogWidthS} ${dialogLayoutClass}`}>
        <div className="min-h-0 overflow-y-auto"><DialogHeader alert title={t("disk.title")} subtitle={t("disk.description", { path: conflict?.path ?? "" })} onClose={keepMine} /></div>
        <DialogFooter>
          <Button variant="secondary" onClick={keepMine}>{t("disk.keep")}</Button>
          <Button ref={primaryRef} variant="primary" autoFocus onClick={() => void reloadFromDisk()}>{t("disk.reload")}</Button>
        </DialogFooter>
      </AlertDialog.Popup>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
