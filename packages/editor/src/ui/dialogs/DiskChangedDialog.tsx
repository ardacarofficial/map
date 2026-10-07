import { AlertDialog } from "@base-ui/react/alert-dialog";
import { t } from "../../i18n";
import { keepMine, reloadFromDisk } from "../../io/session";
import { useSaveStatus } from "../../io/saveStatus";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { backdropClass, popupClass } from "./styles";

/** "Dosya diskte değişti": reload from disk, or keep ours (overwrites on the next save). */
export function DiskChangedDialog() {
  const conflict = useSaveStatus((s) => s.diskConflict);
  return (
    // Escape / outside click mean "keep mine": nothing is lost that way.
    <AlertDialog.Root open={conflict !== null} onOpenChange={(open) => !open && conflict && keepMine()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdropClass} />
        <AlertDialog.Popup className={`${popupClass} w-[460px] max-w-[calc(100vw-32px)] p-5`}>
          <div className="flex gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning-soft text-warning">
              <Icon name="fileWarning" size={18} />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <AlertDialog.Title className="text-lg font-semibold">{t("disk.title")}</AlertDialog.Title>
              <AlertDialog.Description className="text-md text-muted">
                {t("disk.description", { path: conflict?.path ?? "" })}
              </AlertDialog.Description>
            </div>
          </div>
          <dl className="mt-4 flex flex-col gap-2 rounded-lg border border-line bg-panel p-3 text-sm">
            <div>
              <dt className="font-medium text-text">{t("disk.reload")}</dt>
              <dd className="text-faint">{t("disk.reloadHint")}</dd>
            </div>
            <div>
              <dt className="font-medium text-text">{t("disk.keep")}</dt>
              <dd className="text-faint">{t("disk.keepHint")}</dd>
            </div>
          </dl>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => keepMine()}>{t("disk.keep")}</Button>
            <Button variant="primary" autoFocus onClick={() => void reloadFromDisk()}>
              {t("disk.reload")}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
