import { AlertDialog } from "@base-ui/react/alert-dialog";

import { t } from "../../i18n";
import { Button } from "../primitives/Button";
import { useConfirmStore } from "./confirmStore";
import { backdropClass, popupClass } from "./styles";

/** "Save changes?" before replacing or closing a dirty project. */
export function UnsavedDialog() {
  const request = useConfirmStore((s) => s.request);
  return (
    <AlertDialog.Root open={request !== null} onOpenChange={(open) => !open && request?.resolve("cancel")}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdropClass} />
        <AlertDialog.Popup className={`${popupClass} w-[420px] max-w-[calc(100vw-32px)] p-5`}>
          <AlertDialog.Title className="text-lg font-semibold">{t("unsaved.title")}</AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-md text-muted">
            {t("unsaved.description", { name: request?.projectName ?? "" })}
          </AlertDialog.Description>
          <div className="mt-5 flex gap-2">
            <Button variant="ghost" onClick={() => request?.resolve("discard")}>
              {t("common.dontSave")}
            </Button>
            <div className="ml-auto flex gap-2">
              <Button onClick={() => request?.resolve("cancel")}>{t("common.cancel")}</Button>
              <Button variant="primary" autoFocus onClick={() => request?.resolve("save")}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
