import { Dialog } from "../primitives/Overlays";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { backdropClass, popupClass } from "../dialogs/styles";
import { Button } from "../primitives/Button";
import { pasteIntoPalette, createPalette, setPaletteRowCount, showPalette } from "./paletteActions";
import { usePaletteDialogs } from "./paletteDialogsStore";

export function PaletteDialogs() {
  const paste = usePaletteDialogs(s => s.paste);
  const trim = usePaletteDialogs(s => s.trim);
  const store = useEditorStore(s => s.project?.store);
  useStructureVersion(store);
  const close = () => usePaletteDialogs.setState({ paste: false, trim: null });
  const pasteTo = (id: string) => {
    if (pasteIntoPalette(id, null)) { close(); showPalette(id); }
  };
  return <Dialog.Root open={paste || trim !== null} onOpenChange={open => { if (!open) close(); }}>
    <Dialog.Portal>
      <Dialog.Backdrop className={backdropClass} />
      <Dialog.Popup className={`${popupClass} w-100 max-w-[calc(100vw-32px)] max-h-[calc(100dvh-32px)] overflow-y-auto p-4`} data-dialog="palette-references">
        <div className="flex flex-col gap-4">
          <Dialog.Title className="text-lg font-semibold">{t(paste ? "tilesetEditing.pasteToPalette" : "tilesetEditing.trimTitle")}</Dialog.Title>
          {paste ? <>
            <Dialog.Description className="text-sm text-muted">{t("tilesetEditing.pasteHint")}</Dialog.Description>
            <div className="flex max-h-80 flex-col gap-1 overflow-auto">
              {store?.document.collections.map(p => <Button key={p.id} size="sm" data-paste-palette={p.id} onClick={() => pasteTo(p.id)}>{p.name}</Button>)}
              <Button size="sm" onClick={() => {
                close();
                void createPalette().then(id => { if (id) pasteTo(id); });
              }}>{t("palettes.newOption")}</Button>
            </div>
          </> : trim && <Dialog.Description className="text-sm text-muted">{t("tilesetEditing.trimDetail", { name: trim.palette.name, rows: trim.rows })}</Dialog.Description>}
          <div className="flex justify-end gap-2">
            <Button onClick={close}>{t("common.cancel")}</Button>
            {trim && <Button variant="danger" data-palette-trim-confirm onClick={() => {
              // A concurrent undo/edit must not remove references from a different snapshot.
              if (store?.document.getCollection(trim.palette.id) === trim.palette) setPaletteRowCount(trim.palette.id, trim.rows, true);
              close();
            }}>{t("tilesetEditing.trim")}</Button>}
          </div>
        </div>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
