import { Dialog } from "@base-ui/react/dialog";
import { useState, type FormEvent } from "react";

import { defaultStampName, saveSelectionAsStamp, stampRegion, usedStampLayerIds } from "../../commands/stampActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { TextField } from "../primitives/TextField";
import { Icon } from "../primitives/Icon";
import { backdropClass, popupClass, dialogWidthS } from "../dialogs/styles";
import { Button, IconButton } from "../primitives/Button";
import { useUiStore } from "../uiStore";
import { selectAll } from "../primitives/selectAll";

/** stamp.saveSelection — asks for a name, then saves the marquee of every layer. */
export function SaveStampDialog() {
  const open = useUiStore((s) => s.saveStampOpen);
  const setOpen = useUiStore((s) => s.setSaveStampOpen);
  const hasProject = useEditorStore((s) => s.project !== null);
  const show = open && hasProject;
  return (
    <Dialog.Root open={show} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup className={`${popupClass} ${dialogWidthS}`}>{show && <SaveStampForm onDone={() => setOpen(false)} />}</Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SaveStampForm({ onDone }: { onDone(): void }) {
  const [name, setName] = useState(() => defaultStampName(useProjectLibrary.getState().stamps));
  const region = stampRegion();
  const doc = useEditorStore.getState().project?.store.document;
  const layerCount = doc && region ? usedStampLayerIds(doc, region).length : 0;
  const error = name.trim().length === 0 ? t("stamps.errName") : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (error || !region) return;
    if (saveSelectionAsStamp(name)) onDone();
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <div className="flex flex-col gap-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <Dialog.Title className="flex-1 text-lg font-semibold text-title">{t("stamps.dialogTitle")}</Dialog.Title>
          <Dialog.Close
            render={
              <IconButton size="sm" aria-label={t("common.close")}>
                <Icon name="x" size={16} />
              </IconButton>
            }
          />
        </div>
        <Dialog.Description className="text-md text-muted">
          {region ? t("stamps.dialogDescription", { width: region.width, height: region.height, count: layerCount }) : t("stamps.saveDisabled")}
        </Dialog.Description>
      </div>
      <div className="p-4">
        <label className="flex flex-col gap-2 text-sm text-muted">
          <span>{t("stamps.name")}</span>
          <TextField size="md" aria-label={t("stamps.name")} value={name} onChange={(e) => setName(e.target.value)} autoFocus {...selectAll} aria-invalid={!!error} />
          {error && <span className="text-xs text-danger">{error}</span>}
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-line-subtle px-4 py-3">
        <Dialog.Close render={<Button variant="secondary">{t("common.cancel")}</Button>} />
        <Button type="submit" variant="primary" disabled={!!error || !region}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
