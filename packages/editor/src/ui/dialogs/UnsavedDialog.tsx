import { useRef } from "react";
import { AlertDialog } from "../primitives/Overlays";
import { t } from "../../i18n";
import { Button } from "../primitives/Button";
import { useConfirmStore } from "./confirmStore";
import { DialogHeader, DialogFooter, dialogLayoutClass } from "./DialogFrame";
import { backdropClass, popupClass, dialogWidthS } from "./styles";

export function UnsavedDialog() {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const request = useConfirmStore(s => s.request);
  const cancel = () => request?.resolve("cancel");
  return <AlertDialog.Root open={request !== null} onOpenChange={open => !open && cancel()}>
    <AlertDialog.Portal><AlertDialog.Backdrop className={backdropClass} />
      <AlertDialog.Popup initialFocus={primaryRef} className={`${popupClass} ${dialogWidthS} ${dialogLayoutClass}`}>
        <div className="min-h-0 overflow-y-auto"><DialogHeader alert title={t("unsaved.title")} subtitle={t("unsaved.description", { name: request?.projectName ?? "" })} onClose={cancel} /></div>
        <DialogFooter>
          <Button variant="secondary" onClick={cancel}>{t("common.cancel")}</Button>
          <Button variant="secondary" onClick={() => request?.resolve("discard")}>{t("common.dontSave")}</Button>
          <Button ref={primaryRef} variant="primary" autoFocus onClick={() => request?.resolve("save")}>{t("common.save")}</Button>
        </DialogFooter>
      </AlertDialog.Popup>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
