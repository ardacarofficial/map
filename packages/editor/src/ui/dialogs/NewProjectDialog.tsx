import { Dialog } from "@base-ui/react/dialog";
import { DEFAULT_TILE_SIZE } from "@smap/core";
import { useId, useState, type FormEvent } from "react";

import { t } from "../../i18n";
import { DEFAULT_MAP_HEIGHT, DEFAULT_MAP_WIDTH, newProject } from "../../io/session";
import { Button } from "../primitives/Button";
import { useUiStore } from "../uiStore";
import { backdropClass, popupClass } from "./styles";

/** UI limits for a new map (core allows more; the map can be enlarged later). */
const MAP_MIN = 1;
const MAP_MAX = 4096;
const TILE_MIN = 4;
const TILE_MAX = 256;
const TILE_PRESETS = [16, 32, 48, 64];

export function NewProjectDialog() {
  const open = useUiStore((s) => s.newProjectOpen);
  const setOpen = useUiStore((s) => s.setNewProjectOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup className={`${popupClass} w-[400px] max-w-[calc(100vw-32px)]`}>
          {open && <NewProjectForm onDone={() => setOpen(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function parseIntInRange(text: string, min: number, max: number): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function NewProjectForm({ onDone }: { onDone(): void }) {
  const [name, setName] = useState(t("newProject.defaultName"));
  const [width, setWidth] = useState(String(DEFAULT_MAP_WIDTH));
  const [height, setHeight] = useState(String(DEFAULT_MAP_HEIGHT));
  const [tile, setTile] = useState(String(DEFAULT_TILE_SIZE));
  const [touched, setTouched] = useState(false);

  const w = parseIntInRange(width, MAP_MIN, MAP_MAX);
  const h = parseIntInRange(height, MAP_MIN, MAP_MAX);
  const ts = parseIntInRange(tile, TILE_MIN, TILE_MAX);
  const nameOk = name.trim().length > 0;
  const valid = nameOk && w !== null && h !== null && ts !== null;
  const mapErr = t("newProject.errSize", { min: MAP_MIN, max: MAP_MAX });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    void newProject({ name: name.trim(), width: w, height: h, tileSize: ts });
    onDone();
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <div className="flex flex-col gap-1 px-5 pt-5">
        <Dialog.Title className="text-lg font-semibold">{t("newProject.title")}</Dialog.Title>
        <Dialog.Description className="text-md text-muted">{t("newProject.description")}</Dialog.Description>
      </div>

      <div className="flex flex-col gap-4 px-5 py-5">
        <Field
          label={t("newProject.name")}
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
          <div className="flex gap-1">
            {TILE_PRESETS.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setTile(String(size))}
                aria-pressed={ts === size}
                className={`h-6 rounded-sm px-2 font-mono text-xs transition-colors ${
                  ts === size ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <span className="font-mono text-xs text-faint tabular">
          {w !== null && h !== null && ts !== null
            ? t("newProject.summary", { width: w * ts, height: h * ts })
            : " "}
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

function Field({
  label,
  value,
  onChange,
  unit,
  numeric = false,
  error,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  unit?: string;
  numeric?: boolean;
  error: string | null;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-muted">
        {label}
      </label>
      <div
        className={`flex h-8 items-center rounded-md border bg-panel px-2.5 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft ${
          error ? "border-danger" : "border-line hover:border-line-strong"
        }`}
      >
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          autoFocus={autoFocus}
          inputMode={numeric ? "numeric" : "text"}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`h-full min-w-0 flex-1 bg-transparent text-md text-text focus-visible:outline-none ${numeric ? "font-mono tabular" : ""}`}
        />
        {unit && <span className="pl-2 text-sm text-faint">{unit}</span>}
      </div>
      {error && (
        <span id={`${id}-error`} className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
