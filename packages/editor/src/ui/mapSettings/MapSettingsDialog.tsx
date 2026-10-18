import { Dialog } from "@base-ui/react/dialog";
import { entityCell, SPAWN_TYPE_ID } from "@smap/core";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { chooseEntityType } from "../../commands/entityActions";
import { renameLevel } from "../../commands/levelActions";
import { moveLevelOnWorld } from "../../commands/worldActions";
import { t, type MessageKey } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { describeError } from "../../io/session";
import { useEditorStore, type OpenProject } from "../../state/editorStore";
import { getCanvasHandle } from "../canvas/canvasHandle";
import { backdropClass, popupClass, dialogWidthM } from "../dialogs/styles";
import { arrowRotation, type Anchor } from "../dialogs/resizeMath";
import { AdvancedDisclosure, DialogHeader, DialogBody, DialogFooter, dialogLayoutClass, FormField } from "../dialogs/DialogFrame";
import { NumberField, themeBackground } from "../projectSettings/fields";
import { TextField } from "../primitives/TextField";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { toast } from "../toast/toastStore";
import { useUiStore } from "../uiStore";
import {
  applyMapOps,
  cropsMap,
  hasChanges,
  MAP_MAX,
  MAP_MIN,
  mapSettingsChanges,
  parseHexColor,
  type MapSettingsCurrent,
} from "./mapSettingsModel";
import { closeMapSettings, useMapSettingsFocus } from "./mapSettingsStore";
import { selectAll } from "../primitives/selectAll";

const ANCHORS: Anchor[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];

function parseInt32(text: string, min: number, max: number): number | null {
  if (!/^\s*-?\d+\s*$/.test(text)) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * Harita ayarları (Harita menu, Denetçi "Harita ayarları…", `map.settings`;
 * `map.resize` opens it on the size): name, size with anchor, tile size
 * (read-only), background colour, spawn point (Yerleştir / Git), world
 * position and the variant seed (read-only). Size and background apply as
 * one undo step.
 */
export function MapSettingsDialog() {
  const popupRef = useRef<HTMLDivElement>(null);
  const open = useUiStore((s) => s.resizeOpen);
  const setOpen = useUiStore((s) => s.setResizeOpen);
  const project = useEditorStore((s) => s.project);
  return (
    <Dialog.Root open={open && project !== null} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup ref={popupRef} initialFocus={() => popupRef.current?.querySelector<HTMLElement>(`[data-field="${useMapSettingsFocus.getState().focus === "size" ? "width" : "name"}"]`) ?? popupRef.current} className={`${popupClass} ${dialogWidthM} ${dialogLayoutClass}`} data-map-settings>
          {open && project && <MapSettingsForm project={project} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MapSettingsForm({ project }: { project: OpenProject }) {
  const store = project.store;
  const doc = store.document;
  const map = doc.map;
  const focus = useMapSettingsFocus((s) => s.focus);
  const level = useProjectLibrary((s) => (project.levelId ? s.levels.find((l) => l.id === project.levelId) : undefined));
  const current: MapSettingsCurrent = {
    name: level?.name ?? project.name,
    width: map.width,
    height: map.height,
    background: doc.background,
    world: level ? { x: level.world.x, y: level.world.y } : null,
  };
  const max = Math.max(MAP_MAX, map.width, map.height);

  const [name, setName] = useState(current.name);
  const [width, setWidth] = useState(String(map.width));
  const [height, setHeight] = useState(String(map.height));
  const [advanced, setAdvanced] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>(0);
  const [bgText, setBgText] = useState(current.background ?? "");
  const [worldX, setWorldX] = useState(String(current.world?.x ?? 0));
  const [worldY, setWorldY] = useState(String(current.world?.y ?? 0));

  const w = parseInt32(width, MAP_MIN, max);
  const h = parseInt32(height, MAP_MIN, max);
  const bg = parseHexColor(bgText);
  const wx = parseInt32(worldX, -1_000_000, 1_000_000);
  const wy = parseInt32(worldY, -1_000_000, 1_000_000);
  const valid = w !== null && h !== null && bg !== undefined && (!level || (wx !== null && wy !== null));
  const sizeErr = t("newProject.errSize", { min: MAP_MIN, max });

  const changes = valid
    ? mapSettingsChanges(current, { name, width: w, height: h, anchor, background: bg, world: level ? { x: wx!, y: wy! } : null })
    : null;
  const dirty = changes !== null && hasChanges(changes);
  const crops = w !== null && h !== null && cropsMap(map, { width: w, height: h });

  const spawn = doc.spawn();
  const spawnCell = spawn ? entityCell(spawn, map) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!changes || !dirty) return;
    try {
      applyMapOps(store, changes.ops, t("history.mapProps"));
    } catch (error) {
      console.error(error);
      toast.error(describeError(error));
      return;
    }
    if (changes.rename && project.levelId) renameLevel(project.levelId, changes.rename);
    if (changes.world && project.levelId) moveLevelOnWorld({ levelId: project.levelId, x: changes.world.x, y: changes.world.y });
    toast.success(t("mapSettings.applied"));
    closeMapSettings();
  };

  const placeSpawn = () => {
    closeMapSettings();
    chooseEntityType(SPAWN_TYPE_ID);
  };
  const goToSpawn = () => {
    if (!spawnCell) return;
    closeMapSettings();
    getCanvasHandle()?.centerOn(Math.min(map.width - 1, Math.max(0, spawnCell.x)), Math.min(map.height - 1, Math.max(0, spawnCell.y)));
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader title={t("mapSettings.title")} onClose={closeMapSettings} />
      <DialogBody className="flex flex-col gap-3">
          <Row label={t("mapSettings.name")}>
            {(id) => (
              <TextField size="md"
                id={id}
                value={name}
                {...selectAll}
                onChange={(e) => setName(e.target.value)}
                autoFocus={focus === "name"}
                maxLength={80}
                spellCheck={false}
                autoComplete="off"
                data-field="name"
                aria-invalid={name.trim().length === 0 || undefined}
                className={name.trim().length === 0 ? "[&>input]:border-danger" : ""}
              />
            )}
          </Row>

        <div className="grid grid-cols-2 gap-3">
          <Row label={t("resize.width")} error={w === null ? sizeErr : null}>
            {id => <NumberField id={id} label={t("resize.width")} value={width} onChange={setWidth} invalid={w === null} autoFocus={focus === "size"} field="width" width="w-full" unit={t("newProject.cellsUnit")} />}
          </Row>
          <Row label={t("resize.height")} error={h === null ? sizeErr : null}>
            {id => <NumberField id={id} label={t("resize.height")} value={height} onChange={setHeight} invalid={h === null} field="height" width="w-full" unit={t("newProject.cellsUnit")} />}
          </Row>
        </div>
        <AnchorPicker anchor={anchor} onChange={setAnchor} />
          {crops && (
            <div className="mt-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              <Icon name="warning" size={16} className="mt-px shrink-0" />
              {t("resize.cropWarning")}
            </div>
          )}
        <Group title={t("mapSettings.spawn")}>
          <div className="flex items-center gap-2" data-map-settings-spawn={spawnCell ? "set" : "none"}>
            <Icon name="flag" size={16} className={`shrink-0 ${spawnCell ? "text-muted" : "text-warning"}`} />
            <span className="min-w-0 flex-1 truncate text-md text-text">
              {spawnCell ? t("mapSettings.spawnSet", { x: spawnCell.x, y: spawnCell.y }) : t("mapSettings.spawnNone")}
            </span>
            {spawnCell && (
              <Button onClick={goToSpawn}>
                <Icon name="crosshair" size={16} />
                {t("mapSettings.spawnGo")}
              </Button>
            )}
            <Button onClick={placeSpawn}>
              {t("mapSettings.spawnPlace")}
            </Button>
          </div>
        </Group>

        {level && (
          <Group title={t("mapSettings.world")}>
            <div className="flex gap-3">
              <NumberField value={worldX} onChange={setWorldX} prefix={t("mapSettings.x")} unit={t("newProject.pxUnit")} width="w-full" invalid={wx === null} field="worldX" label={`${t("mapSettings.world")} ${t("mapSettings.x")}`} />
              <NumberField value={worldY} onChange={setWorldY} prefix={t("mapSettings.y")} unit={t("newProject.pxUnit")} width="w-full" invalid={wy === null} field="worldY" label={`${t("mapSettings.world")} ${t("mapSettings.y")}`} />
            </div>
          </Group>
        )}

        <AdvancedDisclosure open={advanced} onChange={setAdvanced} label={t("mapSettings.advanced")}>
          <Row label={t("mapSettings.background")} error={bg === undefined ? t("mapSettings.backgroundInvalid") : null}>
            {(id) => (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <label className="relative grid size-control-md shrink-0 cursor-pointer place-items-center overflow-hidden rounded-md border border-line hover:border-line-strong">
                  <span aria-hidden className={`absolute inset-0 ${bg ? "" : "checker"}`} style={bg ? { background: bg } : undefined} />
                  <input
                    type="color"
                    aria-label={t("mapSettings.background")}
                    value={bg ?? themeBackground()}
                    onChange={(e) => setBgText(e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
                <TextField size="md"
                  id={id}
                  value={bgText}
                  placeholder={t("mapSettings.backgroundNone")}
                  onChange={(e) => setBgText(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  data-field="background"
                  className="w-32 flex-none" aria-invalid={bg === undefined || undefined}
                />
                {bg !== null && (
                  <Button variant="ghost" className="px-2" onClick={() => setBgText("")}>
                    {t("mapSettings.backgroundClear")}
                  </Button>
                )}
              </div>
            )}
          </Row>
            <Row label={t("mapSettings.tile")}>{() => <span className="text-md text-text tabular" title={t("mapSettings.tileReadOnly")}>{map.tileWidth} × {map.tileHeight} {t("newProject.pxUnit")}</span>}</Row>
            <FormField label={t("mapSettings.seed")}><span className="text-md text-text tabular select-all" data-field="seed">{doc.seed}</span></FormField>
        </AdvancedDisclosure>
      </DialogBody>
      <DialogFooter status={
          w !== null && h !== null && (w !== map.width || h !== map.height)
            ? t("resize.summary", { fromWidth: map.width, fromHeight: map.height, toWidth: w, toHeight: h })
            : valid && !dirty
              ? t("mapSettings.unchanged")
              : " "
      }>
        <Button variant="secondary" onClick={closeMapSettings}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={!valid || !dirty} data-map-settings-apply>{t("mapSettings.apply")}</Button>
      </DialogFooter>
    </form>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex flex-col gap-3 border-t border-line-subtle pt-3">
    <h3 className="text-xs font-semibold tracking-section text-muted uppercase">{title}</h3>{children}
  </section>;
}

function Row({ label, error, children }: { label: string; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return <FormField label={label} htmlFor={id} error={error}>{children(id)}</FormField>;
}

function AnchorPicker({ anchor, onChange }: { anchor: Anchor; onChange(a: Anchor): void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted">{t("resize.anchor")}</span>
      <div role="radiogroup" aria-label={t("resize.anchor")} className="grid w-fit grid-cols-3 gap-1 rounded-sm border border-line bg-field p-1.5">
        {ANCHORS.map((cell) => {
          const rotation = arrowRotation(cell, anchor);
          const label = t(`resize.pos${cell}` as MessageKey);
          return (
            <button
              key={cell}
              type="button"
              role="radio"
              aria-checked={cell === anchor}
              aria-label={t("resize.anchorCell", { position: label })}
              title={label}
              onClick={() => onChange(cell)}
              className={`grid size-7 place-items-center rounded-sm transition-colors duration-(--duration-fast) ${
                cell === anchor ? "border border-line-strong bg-active text-title" : "text-muted hover:bg-hover hover:text-muted"
              }`}
            >
              {cell === anchor ? (
                <span className="size-3 rounded-xs bg-muted" />
              ) : rotation !== null ? (
                <span style={{ transform: `rotate(${rotation}deg)` }} className="grid place-items-center">
                  <Icon name="arrowUp" size={16} />
                </span>
              ) : (
                <span className="size-1.5 rounded-full bg-line-strong" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
