import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState, type FormEvent } from "react";

import { createLevel, nextLevelName, openNewLevelDialog, portalsTo, removeLevel, askRemoveLevel, useLevelUi } from "../../commands/levelActions";
import { t } from "../../i18n";
import type { PortalReferences } from "../../io/levelWorkspace";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { Field, parseIntInRange } from "../dialogs/NewProjectDialog";
import { backdropClass, popupClass } from "../dialogs/styles";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";

const MAP_MIN = 1;
const MAP_MAX = 4096;
const TILE_MIN = 4;
const TILE_MAX = 256;

/** "Yeni level": name, size (defaults to the open level's) and tile size (defaults to the project's). */
export function NewLevelDialog() {
  const open = useLevelUi((s) => s.newLevelOpen);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => openNewLevelDialog(o)}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup className={`${popupClass} w-[400px] max-w-[calc(100vw-32px)]`} data-dialog="new-level">
          {open && <NewLevelForm onDone={() => openNewLevelDialog(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NewLevelForm({ onDone }: { onDone(): void }) {
  const doc = useEditorStore.getState().project?.store.document;
  const projectTile = doc?.tilesets[0]?.tileWidth ?? doc?.map.tileWidth ?? 32;
  const [name, setName] = useState(nextLevelName);
  // New-map defaults come from the project settings.
  const defaults = useProjectLibrary.getState().settings;
  const [width, setWidth] = useState(String(defaults.newLevel.width));
  const [height, setHeight] = useState(String(defaults.newLevel.height));
  const [tile, setTile] = useState(String(defaults.tileWidth));
  const [touched, setTouched] = useState(false);

  const w = parseIntInRange(width, MAP_MIN, MAP_MAX);
  const h = parseIntInRange(height, MAP_MIN, MAP_MAX);
  const ts = parseIntInRange(tile, TILE_MIN, TILE_MAX);
  const nameOk = name.trim().length > 0;
  const valid = nameOk && w !== null && h !== null && ts !== null;
  const mapErr = t("newProject.errSize", { min: MAP_MIN, max: MAP_MAX });
  const tilesetSize = doc?.tilesets[0]?.tileWidth;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    onDone();
    void createLevel({ name: name.trim(), width: w, height: h, tileSize: ts });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <div className="flex flex-col gap-1 px-5 pt-5">
        <Dialog.Title className="text-lg font-semibold">{t("levels.newTitle")}</Dialog.Title>
        <Dialog.Description className="text-md text-muted">{t("levels.newDescription")}</Dialog.Description>
      </div>
      <div className="flex flex-col gap-4 px-5 py-5">
        <Field
          label={t("levels.newName")}
          value={name}
          onChange={setName}
          error={touched && !nameOk ? t("newProject.errName") : null}
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t("newProject.width")}
            value={width}
            onChange={setWidth}
            unit={t("newProject.cellsUnit")}
            numeric
            error={(touched || width !== "") && w === null ? mapErr : null}
          />
          <Field
            label={t("newProject.height")}
            value={height}
            onChange={setHeight}
            unit={t("newProject.cellsUnit")}
            numeric
            error={(touched || height !== "") && h === null ? mapErr : null}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Field
            label={t("newProject.tileSize")}
            value={tile}
            onChange={setTile}
            unit={t("newProject.pxUnit")}
            numeric
            error={(touched || tile !== "") && ts === null ? t("newProject.errSize", { min: TILE_MIN, max: TILE_MAX }) : null}
          />
          {tilesetSize !== undefined && ts !== null && ts !== tilesetSize ? (
            <span className="flex items-center gap-1.5 text-xs text-warning">
              <Icon name="warning" size={12} className="shrink-0" />
              {t("levels.tileSizeDiffers", { size: tilesetSize })}
            </span>
          ) : (
            <span className="text-xs text-faint">{t("levels.tileSizeProject", { size: projectTile })}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <span className="font-mono text-xs text-faint tabular">
          {w !== null && h !== null && ts !== null ? t("newProject.summary", { width: w * ts, height: h * ts }) : " "}
        </span>
        <div className="ml-auto flex gap-2">
          <Dialog.Close render={<Button variant="ghost">{t("common.cancel")}</Button>} />
          <Button type="submit" variant="primary" disabled={touched && !valid}>
            {t("common.create")}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Delete confirmation: not undoable, so it says how many portals will turn red. */
export function RemoveLevelDialog() {
  const id = useLevelUi((s) => s.removeLevelId);
  const level = useProjectLibrary((s) => s.levels.find((l) => l.id === id));
  const open = id !== null && level !== undefined;
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !o && askRemoveLevel(null)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdropClass} />
        <AlertDialog.Popup className={`${popupClass} w-[440px] max-w-[calc(100vw-32px)] p-5`} data-dialog="remove-level">
          {open && <RemoveLevelBody id={level.id} name={level.name} />}
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function RemoveLevelBody({ id, name }: { id: string; name: string }) {
  const [refs, setRefs] = useState<PortalReferences | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    portalsTo(id).then(
      (r) => live && setRefs(r),
      () => live && setRefs({ count: 0, levels: [], unreadable: 0 }),
    );
    return () => {
      live = false;
    };
  }, [id]);

  const confirm = async () => {
    setBusy(true);
    askRemoveLevel(null);
    await removeLevel(id);
  };

  return (
    <>
      <AlertDialog.Title className="text-lg font-semibold">{t("levels.removeTitle", { name })}</AlertDialog.Title>
      <AlertDialog.Description className="mt-1.5 text-md text-muted">{t("levels.removeDescription")}</AlertDialog.Description>
      <div
        className={`mt-4 flex items-start gap-2 rounded-md px-3 py-2.5 text-sm leading-5 ${
          refs && refs.count > 0 ? "bg-danger-soft text-danger" : "bg-raised text-muted"
        }`}
        data-portal-refs={refs?.count ?? ""}
      >
        <Icon name={refs && refs.count > 0 ? "warning" : "portal"} size={14} className="mt-0.5 shrink-0" />
        <span className="flex flex-col gap-1">
          <span>
            {refs === null
              ? t("levels.removeScanning")
              : refs.count > 0
                ? t("levels.removePortals", { count: refs.count, levels: refs.levels.join(", ") })
                : t("levels.removeNoPortals")}
          </span>
          {refs && refs.unreadable > 0 && <span className="text-xs text-faint">{t("levels.removeUnreadable", { count: refs.unreadable })}</span>}
        </span>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <AlertDialog.Close render={<Button variant="ghost">{t("common.cancel")}</Button>} />
        <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
          {t("levels.removeConfirm")}
        </Button>
      </div>
    </>
  );
}
