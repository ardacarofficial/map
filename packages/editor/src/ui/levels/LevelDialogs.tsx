import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState, type FormEvent } from "react";

import { createLevel, nextLevelName, openNewLevelDialog, portalsTo, removeLevel, askRemoveLevel, useLevelUi } from "../../commands/levelActions";
import { t } from "../../i18n";
import type { PortalReferences } from "../../io/levelWorkspace";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { parseIntInRange } from "../dialogs/NewProjectDialog";
import { backdropClass, popupClass, dialogWidthS } from "../dialogs/styles";
import { Button, IconButton } from "../primitives/Button";
import { TextField } from "../primitives/TextField";
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
        <Dialog.Popup className={`${popupClass} ${dialogWidthS}`} data-dialog="new-level">
          {open && <NewLevelForm onDone={() => openNewLevelDialog(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NewLevelForm({ onDone }: { onDone(): void }) {
  const doc = useEditorStore.getState().project?.store.document;
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
      <div className="flex flex-col gap-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <Dialog.Title className="flex-1 text-lg font-semibold text-title">{t("levels.newTitle")}</Dialog.Title>
          <Dialog.Close
            render={
              <IconButton size="sm" aria-label={t("common.close")}>
                <Icon name="x" size={16} />
              </IconButton>
            }
          />
        </div>
        <Dialog.Description className="text-md text-muted">{t("levels.newDescription")}</Dialog.Description>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <LevelField label={t("levels.newName")} value={name} onChange={setName} error={touched && !nameOk ? t("newProject.errName") : null} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <LevelField
            label={t("newProject.width")}
            value={width}
            onChange={setWidth}
            unit={t("newProject.cellsUnit")}
            numeric
            error={(touched || width !== "") && w === null ? mapErr : null}
          />
          <LevelField
            label={t("newProject.height")}
            value={height}
            onChange={setHeight}
            unit={t("newProject.cellsUnit")}
            numeric
            error={(touched || height !== "") && h === null ? mapErr : null}
          />
        </div>
        <div className="flex flex-col gap-2">
          <LevelField
            label={t("newProject.tileSize")}
            value={tile}
            onChange={setTile}
            unit={t("newProject.pxUnit")}
            numeric
            error={(touched || tile !== "") && ts === null ? t("newProject.errSize", { min: TILE_MIN, max: TILE_MAX }) : null}
          />
          {tilesetSize !== undefined && ts !== null && ts !== tilesetSize && (
            <span className="text-xs text-warning">{t("levels.tileSizeDiffers", { size: tilesetSize })}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line-subtle px-4 py-3">
        <div className="ml-auto flex gap-2">
          <Dialog.Close render={<Button variant="secondary">{t("common.cancel")}</Button>} />
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
        <AlertDialog.Popup className={`${popupClass} ${dialogWidthS} p-4`} data-dialog="remove-level">
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
      <div className="flex items-center gap-2">
        <AlertDialog.Title className="flex-1 text-lg font-semibold text-title">{t("levels.removeTitle", { name })}</AlertDialog.Title>
        <AlertDialog.Close
          render={
            <IconButton size="sm" aria-label={t("common.close")}>
              <Icon name="x" size={16} />
            </IconButton>
          }
        />
      </div>
      <AlertDialog.Description className="mt-2 text-md text-muted">{t("levels.removeDescription")}</AlertDialog.Description>
      <div
        className={`mt-4 flex items-start gap-2 rounded-md text-sm ${refs && refs.count > 0 ? "text-danger" : "text-muted"}`}
        data-portal-refs={refs?.count ?? ""}
      >
        <Icon name={refs && refs.count > 0 ? "warning" : "portal"} size={16} className="mt-0.5 shrink-0" />
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
      <div className="mt-4 flex justify-end gap-2">
        <AlertDialog.Close render={<Button variant="secondary">{t("common.cancel")}</Button>} />
        <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
          {t("levels.removeConfirm")}
        </Button>
      </div>
    </>
  );
}

/** Labelled 28px input used by the map creation dialog. */
function LevelField({
  label,
  value,
  onChange,
  error,
  unit,
  numeric,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  error?: string | null;
  unit?: string;
  numeric?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-sm text-muted">
      <span>{label}</span>
      <TextField
        size="md"
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value)}
        inputMode={numeric ? "numeric" : undefined}
        autoFocus={autoFocus}
        aria-label={label}
        aria-invalid={!!error}
        trailing={unit && <span className="text-xs">{unit}</span>}
      />
      {error && <span className="text-xs text-danger">{error}</span>}
    </label>
  );
}
