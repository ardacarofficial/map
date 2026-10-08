import { Dialog } from "@base-ui/react/dialog";
import { useState, type FormEvent } from "react";

import { defaultStampName, saveSelectionAsStamp, stampRegion, usedStampLayerIds } from "../../commands/stampActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { Field } from "../dialogs/NewProjectDialog";
import { backdropClass, popupClass } from "../dialogs/styles";
import { Button } from "../primitives/Button";
import { useUiStore } from "../uiStore";

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
        <Dialog.Popup className={`${popupClass} w-[400px] max-w-[calc(100vw-32px)]`}>
          {show && <SaveStampForm onDone={() => setOpen(false)} />}
        </Dialog.Popup>
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
      <div className="flex flex-col gap-1 px-5 pt-5">
        <Dialog.Title className="text-lg font-semibold">{t("stamps.dialogTitle")}</Dialog.Title>
        <Dialog.Description className="text-md text-muted">
          {region
            ? t("stamps.dialogDescription", { width: region.width, height: region.height, count: layerCount })
            : t("stamps.saveDisabled")}
        </Dialog.Description>
      </div>
      <div className="px-5 py-5">
        <Field label={t("stamps.name")} value={name} onChange={setName} autoFocus error={error} />
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Dialog.Close render={<Button variant="ghost">{t("common.cancel")}</Button>} />
        <Button type="submit" variant="primary" disabled={!!error || !region}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
