import { Dialog } from "@base-ui/react/dialog";
import { entityCell, SPAWN_TYPE_ID } from "@smap/core";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { chooseEntityType } from "../../commands/entityActions";
import { renameLevel } from "../../commands/levelActions";
import { moveLevelOnWorld } from "../../commands/worldActions";
import { formatNumber, t, type MessageKey } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { describeError } from "../../io/session";
import { useEditorStore, type OpenProject } from "../../state/editorStore";
import { getCanvasHandle } from "../canvas/canvasHandle";
import { backdropClass, popupClass } from "../dialogs/styles";
import { arrowRotation, type Anchor } from "../dialogs/resizeMath";
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
  const open = useUiStore((s) => s.resizeOpen);
  const setOpen = useUiStore((s) => s.setResizeOpen);
  const project = useEditorStore((s) => s.project);
  return (
    <Dialog.Root open={open && project !== null} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup className={`${popupClass} flex max-h-[calc(100vh-48px)] w-[560px] max-w-[calc(100vw-32px)] flex-col`} data-map-settings>
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
      <div className="flex flex-col gap-1 px-5 pt-5 pb-3">
        <Dialog.Title className="text-lg font-semibold">{t("mapSettings.title")}</Dialog.Title>
        <Dialog.Description className="text-md text-muted">{t("mapSettings.description")}</Dialog.Description>
      </div>

      <div className="flex min-h-0 flex-col overflow-y-auto px-5 pb-4">
        <Group title={t("mapSettings.general")}>
          <Row label={t("mapSettings.name")}>
            {(id) => (
              <input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus={focus === "name"}
                maxLength={80}
                spellCheck={false}
                autoComplete="off"
                data-field="name"
                className={inputClass(name.trim().length > 0)}
              />
            )}
          </Row>
          <Row label={t("mapSettings.tile")}>
            {() => (
              <span className="flex h-8 items-center gap-2 text-md text-text" title={t("mapSettings.tileReadOnly")}>
                <span className="font-mono tabular">
                  {map.tileWidth} × {map.tileHeight} px
                </span>
                <span className="text-xs text-faint">{t("mapSettings.tileReadOnly")}</span>
              </span>
            )}
          </Row>
          <Row label={t("mapSettings.background")} error={bg === undefined ? t("mapSettings.backgroundInvalid") : null}>
            {(id) => (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <label className="relative grid size-8 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-md border border-line hover:border-line-strong">
                  <span aria-hidden className={`absolute inset-0 ${bg ? "" : "checker"}`} style={bg ? { background: bg } : undefined} />
                  <input
                    type="color"
                    aria-label={t("mapSettings.background")}
                    value={bg ?? "#11171c"}
                    onChange={(e) => setBgText(e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
                <input
                  id={id}
                  value={bgText}
                  placeholder={t("mapSettings.backgroundNone")}
                  onChange={(e) => setBgText(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  data-field="background"
                  className={`${inputClass(bg !== undefined)} w-[120px] flex-none font-mono`}
                />
                {bg !== null && (
                  <Button variant="ghost" className="h-8 px-2 text-sm" onClick={() => setBgText("")}>
                    {t("mapSettings.backgroundClear")}
                  </Button>
                )}
              </div>
            )}
          </Row>
        </Group>

        <Group title={t("mapSettings.size")}>
          <div className="flex gap-5">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Row label={t("resize.width")} error={w === null ? sizeErr : null}>
                {(id) => (
                  <NumberInput id={id} value={width} onChange={setWidth} unit={t("newProject.cellsUnit")} invalid={w === null} autoFocus={focus === "size"} field="width" />
                )}
              </Row>
              <Row label={t("resize.height")} error={h === null ? sizeErr : null}>
                {(id) => <NumberInput id={id} value={height} onChange={setHeight} unit={t("newProject.cellsUnit")} invalid={h === null} field="height" />}
              </Row>
              <span className="pl-[96px] font-mono text-xs text-faint tabular">
                {w !== null && h !== null ? `${formatNumber(w * map.tileWidth)} × ${formatNumber(h * map.tileHeight)} px` : " "}
              </span>
            </div>
            <AnchorPicker anchor={anchor} onChange={setAnchor} />
          </div>
          {crops && (
            <div className="mt-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              <Icon name="warning" size={14} className="mt-px shrink-0" />
              {t("resize.cropWarning")}
            </div>
          )}
        </Group>

        <Group title={t("mapSettings.spawn")}>
          <div className="flex items-center gap-2" data-map-settings-spawn={spawnCell ? "set" : "none"}>
            <Icon name="flag" size={16} className={`shrink-0 ${spawnCell ? "text-entity-spawn" : "text-warning"}`} />
            <span className="min-w-0 flex-1 truncate text-md text-text">
              {spawnCell ? t("mapSettings.spawnSet", { x: spawnCell.x, y: spawnCell.y }) : t("mapSettings.spawnNone")}
            </span>
            {spawnCell && (
              <Button className="h-7 px-2.5 text-sm" onClick={goToSpawn}>
                <Icon name="crosshair" size={13} />
                {t("mapSettings.spawnGo")}
              </Button>
            )}
            <Button className="h-7 px-2.5 text-sm" onClick={placeSpawn}>
              {t("mapSettings.spawnPlace")}
            </Button>
          </div>
        </Group>

        {level && (
          <Group title={t("mapSettings.world")} hint={t("mapSettings.worldHint")}>
            <div className="flex gap-3">
              <NumberInput value={worldX} onChange={setWorldX} prefix="X" unit="px" invalid={wx === null} field="worldX" label={`${t("mapSettings.world")} X`} />
              <NumberInput value={worldY} onChange={setWorldY} prefix="Y" unit="px" invalid={wy === null} field="worldY" label={`${t("mapSettings.world")} Y`} />
            </div>
          </Group>
        )}

        <details className="group mt-4 rounded-md border border-line">
          <summary className="flex h-9 cursor-pointer list-none items-center gap-2 px-3 text-xs font-semibold tracking-[0.06em] text-muted uppercase select-none">
            <Icon name="chevronRight" size={13} className="transition-transform group-open:rotate-90" />
            {t("mapSettings.advanced")}
          </summary>
          <div className="flex flex-col gap-1 px-3 pb-3">
            <div className="flex items-center gap-3 text-md">
              <span className="w-[84px] shrink-0 text-muted">{t("mapSettings.seed")}</span>
              <span className="font-mono text-text tabular select-all" data-field="seed">
                {doc.seed}
              </span>
            </div>
            <span className="text-xs leading-4 text-faint">{t("mapSettings.seedHint")}</span>
          </div>
        </details>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <span className="min-w-0 truncate font-mono text-xs text-faint tabular">
          {w !== null && h !== null && (w !== map.width || h !== map.height)
            ? t("resize.summary", { fromWidth: map.width, fromHeight: map.height, toWidth: w, toHeight: h })
            : valid && !dirty
              ? t("mapSettings.unchanged")
              : " "}
        </span>
        <div className="ml-auto flex shrink-0 gap-2">
          <Dialog.Close render={<Button variant="ghost">{t("common.cancel")}</Button>} />
          <Button type="submit" variant="primary" disabled={!valid || !dirty} data-map-settings-apply>
            {t("mapSettings.apply")}
          </Button>
        </div>
      </div>
    </form>
  );
}

function inputClass(ok: boolean): string {
  return `h-8 min-w-0 flex-1 rounded-md border bg-raised px-2.5 text-md text-text transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:outline-none ${
    ok ? "border-line hover:border-line-strong" : "border-danger"
  }`;
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-3 pb-4 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-2">
        <h3 className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{title}</h3>
        {hint && <span className="truncate text-xs text-faint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, error = null, children }: { label: string; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <label htmlFor={id} className="w-[84px] shrink-0 text-md text-muted">
          {label}
        </label>
        {children(id)}
      </div>
      {error && <span className="pl-[96px] text-xs text-danger">{error}</span>}
    </div>
  );
}

function NumberInput({
  id,
  value,
  onChange,
  unit,
  prefix,
  invalid,
  autoFocus = false,
  field,
  label,
}: {
  id?: string;
  value: string;
  onChange(v: string): void;
  unit?: string;
  prefix?: string;
  invalid: boolean;
  autoFocus?: boolean;
  field: string;
  label?: string;
}) {
  return (
    <div
      className={`flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border bg-raised px-2.5 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft ${
        invalid ? "border-danger" : "border-line hover:border-line-strong"
      }`}
    >
      {prefix && <span className="font-mono text-xs text-faint">{prefix}</span>}
      <input
        id={id}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        inputMode="numeric"
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        data-field={field}
        className="h-full w-full min-w-0 bg-transparent font-mono text-md text-text tabular focus-visible:outline-none"
      />
      {unit && <span className="shrink-0 text-xs text-faint">{unit}</span>}
    </div>
  );
}

function AnchorPicker({ anchor, onChange }: { anchor: Anchor; onChange(a: Anchor): void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted">{t("resize.anchor")}</span>
      <div role="radiogroup" aria-label={t("resize.anchor")} className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-raised p-1.5">
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
              className={`grid size-7 place-items-center rounded-sm transition-colors ${
                cell === anchor ? "bg-accent-soft text-accent" : "text-faint hover:bg-hover hover:text-muted"
              }`}
            >
              {cell === anchor ? (
                <span className="size-3 rounded-xs bg-accent" />
              ) : rotation !== null ? (
                <span style={{ transform: `rotate(${rotation}deg)` }} className="grid place-items-center">
                  <Icon name="arrowUp" size={13} />
                </span>
              ) : (
                <span className="size-1 rounded-full bg-line-strong" />
              )}
            </button>
          );
        })}
      </div>
      <span className="max-w-[112px] text-xs leading-4 text-faint">{t("resize.anchorHint")}</span>
    </div>
  );
}
