/**
 * Small form parts shared by the new project dialog and the project
 * settings dialog: chip rows, the tile size / map size pickers, the layer
 * template editor and the background colour field. Tokens only.
 */
import { useId, type ReactNode } from "react";

import { t } from "../../i18n";
import { FormField } from "../dialogs/DialogFrame";
import { Button, IconButton } from "../primitives/Button";
import { Segmented } from "../primitives/Segmented";
import { TextField } from "../primitives/TextField";
import { Icon } from "../primitives/Icon";
import { NativeSelect } from "../primitives/NativeSelect";
import {
  MAP_MAX,
  MAP_MIN,
  MAP_SIZE_PRESETS,
  TILE_MAX,
  TILE_MIN,
  TILE_SIZE_CHIPS,
  layersFor,
  mapPresetOf,
  parseHexColor,
  type LayerKind,
  type LayerSpec,
  type LayerTemplateId,
  type MapSizePresetId,
} from "./projectTemplates";

export function Section({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return <FormField label={label} htmlFor={htmlFor} title={typeof hint === "string" ? hint : undefined}>{children}</FormField>;
}

/** Compatibility wrapper: shared neutral radio segments for small enums. */
export function ChipRow<T extends string | number>({ options, value, onChange, label }: {
  options: readonly { value: T; label: string; title?: string }[];
  value: T | null; onChange(value: T): void; label: string; mono?: boolean;
}) {
  return <Segmented size="md" label={label} value={String(value)} className="max-w-full tabular"
    onValueChange={(next) => { const option = options.find(o => String(o.value) === next); if (option) onChange(option.value); }}
    items={options.map(option => ({ value: String(option.value), label: option.label, ...(option.title ? { tooltip: option.title } : {}) }))} />;
}

/** Shared editable number, used by project and map settings. */
export function NumberField({ value, onChange, prefix, label, invalid, width = "w-20", id, autoFocus, field, unit }: {
  value: string; onChange(value: string): void; prefix?: string; label: string; invalid: boolean;
  width?: string; id?: string; autoFocus?: boolean; field?: string; unit?: string;
}) {
  return <TextField size="md" id={id} value={value} onChange={e => onChange(e.target.value)}
    onFocus={e => e.currentTarget.select()} inputMode="numeric" aria-label={label}
    aria-invalid={invalid || undefined} autoFocus={autoFocus} spellCheck={false} autoComplete="off"
    data-field={field} className={`${width} tabular ${invalid ? "[&>input]:border-danger" : ""}`}
    {...(prefix ? { leadingIcon: <span className="text-sm text-muted">{prefix}</span> } : {})}
    trailing={unit ? <span className="text-xs text-muted">{unit}</span> : undefined} />;
}
export const NumberBox = NumberField;

// ------------------------------------------------------------------ tile size

export interface TileSizeValue {
  /** A chip size, or `"custom"` (W × H inputs shown). */
  chip: number | "custom";
  width: string;
  height: string;
}

export function tileSizeFrom(width: number, height: number): TileSizeValue {
  const chip = width === height && (TILE_SIZE_CHIPS as readonly number[]).includes(width) ? width : "custom";
  return { chip, width: String(width), height: String(height) };
}

/** Parsed tile size, or `null` when the custom inputs are invalid. */
export function parseTileSize(value: TileSizeValue): { width: number; height: number } | null {
  if (value.chip !== "custom") return { width: value.chip, height: value.chip };
  const w = parseInt(value.width, 10);
  const h = parseInt(value.height, 10);
  const ok = (n: number, s: string) => /^\s*\d+\s*$/.test(s) && n >= TILE_MIN && n <= TILE_MAX;
  return ok(w, value.width) && ok(h, value.height) ? { width: w, height: h } : null;
}

export function TileSizePicker({ value, onChange, showErrors }: { value: TileSizeValue; onChange(value: TileSizeValue): void; showErrors: boolean }) {
  const parsed = parseTileSize(value);
  return (
    <div className="flex flex-col gap-1.5">
      <ChipRow
        label={t("newProject.tileSize")}
        value={value.chip}
        onChange={(chip) => onChange(chip === "custom" ? { ...value, chip } : { chip, width: String(chip), height: String(chip) })}
        options={[...TILE_SIZE_CHIPS.map((n) => ({ value: n as number | "custom", label: String(n) })), { value: "custom", label: t("newProject.custom") }]}
      />
      {value.chip === "custom" && (
        <div className="flex items-center gap-1.5">
          <NumberBox
            label={t("newProject.width")}
            prefix={t("newProject.tileWidthShort")}
            value={value.width}
            onChange={(width) => onChange({ ...value, width })}
            invalid={showErrors && parsed === null}
          />
          <span className="text-muted">×</span>
          <NumberBox
            label={t("newProject.height")}
            prefix={t("newProject.tileHeightShort")}
            value={value.height}
            onChange={(height) => onChange({ ...value, height })}
            invalid={showErrors && parsed === null}
          />
          <span className="text-sm text-muted">{t("newProject.pxUnit")}</span>
        </div>
      )}
      {showErrors && parsed === null && <span className="text-sm text-danger">{t("newProject.errSize", { min: TILE_MIN, max: TILE_MAX })}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ map size

export interface MapSizeValue {
  preset: MapSizePresetId | "custom";
  width: string;
  height: string;
}

export function mapSizeFrom(width: number, height: number): MapSizeValue {
  return { preset: mapPresetOf(width, height), width: String(width), height: String(height) };
}

export function parseMapSize(value: MapSizeValue): { width: number; height: number } | null {
  if (value.preset !== "custom") return MAP_SIZE_PRESETS[value.preset];
  const ok = (s: string) => /^\s*\d+\s*$/.test(s) && Number(s) >= MAP_MIN && Number(s) <= MAP_MAX;
  return ok(value.width) && ok(value.height) ? { width: Number(value.width), height: Number(value.height) } : null;
}

export function MapSizePicker({ value, onChange, showErrors }: { value: MapSizeValue; onChange(value: MapSizeValue): void; showErrors: boolean }) {
  const parsed = parseMapSize(value);
  const label = (id: MapSizePresetId) => {
    const p = MAP_SIZE_PRESETS[id];
    const name = id === "small" ? t("newProject.sizeSmall") : id === "medium" ? t("newProject.sizeMedium") : t("newProject.sizeLarge");
    return { value: id as MapSizeValue["preset"], label: name, title: t("common.cells", { width: p.width, height: p.height }) };
  };
  return (
    <div className="flex flex-col gap-1.5">
      <ChipRow
        label={t("newProject.mapSize")}
        value={value.preset}
        onChange={(preset) => {
          if (preset === "custom") onChange({ ...value, preset });
          else onChange({ preset, width: String(MAP_SIZE_PRESETS[preset].width), height: String(MAP_SIZE_PRESETS[preset].height) });
        }}
        options={[label("small"), label("medium"), label("large"), { value: "custom", label: t("newProject.custom") }]}
      />
      <div className="flex items-center gap-1.5">
        <NumberBox
          label={t("newProject.width")}
          prefix={t("newProject.tileWidthShort")}
          value={value.width}
          onChange={(width) => onChange({ preset: mapPresetOf(Number(width), Number(value.height)), width, height: value.height })}
          invalid={showErrors && parsed === null}
        />
        <span className="text-muted">×</span>
        <NumberBox
          label={t("newProject.height")}
          prefix={t("newProject.tileHeightShort")}
          value={value.height}
          onChange={(height) => onChange({ preset: mapPresetOf(Number(value.width), Number(height)), width: value.width, height })}
          invalid={showErrors && parsed === null}
        />
        <span className="text-sm text-muted">{t("newProject.cellsUnit")}</span>
      </div>
      {showErrors && parsed === null && <span className="text-sm text-danger">{t("newProject.errSize", { min: MAP_MIN, max: MAP_MAX })}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ layer template

export interface LayerTemplateValue {
  id: LayerTemplateId;
  /** The custom list (kept while another template is selected). */
  custom: LayerSpec[];
}

/** The layers a template value stands for. */
export function layersOf(value: LayerTemplateValue): LayerSpec[] {
  return value.id === "custom" ? value.custom : layersFor(value.id);
}

const KIND_ICON: Record<LayerKind, "layers" | "shield" | "flag"> = { tile: "layers", collision: "shield", entity: "flag" };

export function kindLabel(kind: LayerKind): string {
  return kind === "tile" ? t("templates.kindTile") : kind === "collision" ? t("templates.kindCollision") : t("templates.kindEntity");
}

export function LayerKindIcon({ kind, className = "" }: { kind: LayerKind; className?: string }) {
  return <Icon name={KIND_ICON[kind]} size={16} className={className} />;
}

export function LayerTemplatePicker({ value, onChange }: { value: LayerTemplateValue; onChange(value: LayerTemplateValue): void }) {
  return (
    <div className="flex flex-col gap-2">
      <ChipRow
        label={t("newProject.layerTemplate")}
        value={value.id}
        onChange={(id) => {
          // Entering "Özel" starts from what was shown, so the user edits instead of retyping.
          if (id === "custom" && value.id !== "custom") onChange({ id, custom: layersFor(value.id) });
          else onChange({ ...value, id });
        }}
        options={[
          { value: "standard" as LayerTemplateId, label: t("newProject.templateStandard") },
          { value: "single", label: t("newProject.templateSingle") },
          { value: "custom", label: t("newProject.templateCustom") },
        ]}
      />
      {value.id === "custom" && <LayerListEditor layers={value.custom} onChange={(custom) => onChange({ ...value, custom })} />}
    </div>
  );
}

/** Editable layer list, shown top layer first (like the layer panel). */
export function LayerListEditor({ layers, onChange }: { layers: LayerSpec[]; onChange(layers: LayerSpec[]): void }) {
  const set = (index: number, patch: Partial<LayerSpec>) => onChange(layers.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= layers.length) return;
    const next = [...layers];
    [next[index], next[to]] = [next[to]!, next[index]!];
    onChange(next);
  };
  const order = layers.map((_, i) => layers.length - 1 - i);
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-line bg-field p-1.5">
      <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {order.map((index) => {
          const layer = layers[index]!;
          return (
            <li key={index} className="flex items-center gap-1">
              <LayerKindIcon kind={layer.kind} className="mx-1 shrink-0 text-muted" />
              <TextField size="md"
                value={layer.name}
                onChange={(e) => set(index, { name: e.target.value })}
                placeholder={t("newProject.layerNamePlaceholder")}
                aria-label={t("newProject.layerNamePlaceholder")}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={layer.name.trim() === "" || undefined}
                className={layer.name.trim() === "" ? "[&>input]:border-danger" : ""}
              />
              <NativeSelect
                className="w-28 shrink-0"
                aria-label={t("newProject.layerKind")}
                value={layer.kind}
                onChange={(e) => set(index, { kind: e.target.value as LayerKind })}
              >
                {(["tile", "collision", "entity"] as const).map((kind) => (
                  <option key={kind} value={kind}>
                    {kindLabel(kind)}
                  </option>
                ))}
              </NativeSelect>
              <RowButton label={t("newProject.moveLayerUp")} icon="arrowUp" disabled={index === layers.length - 1} onClick={() => move(index, 1)} />
              <RowButton label={t("newProject.moveLayerDown")} icon="arrowDown" disabled={index === 0} onClick={() => move(index, -1)} />
              <RowButton label={t("newProject.removeLayer")} icon="x" disabled={layers.length <= 1} onClick={() => onChange(layers.filter((_, i) => i !== index))} />
            </li>
          );
        })}
      </ul>
      <Button variant="ghost" size="sm" className="self-start" onClick={() => onChange([...layers, { name: "", kind: "tile" }])}>
        <Icon name="plus" size={16} />{t("newProject.addLayer")}
      </Button>
    </div>
  );
}

function RowButton({ label, icon, disabled, onClick }: { label: string; icon: "arrowUp" | "arrowDown" | "x"; disabled: boolean; onClick(): void }) {
  return (
    <IconButton size="sm" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={16} />
    </IconButton>
  );
}

// ------------------------------------------------------------------ background

/** Colour swatch + hex input; `null` = theme colour. */
export function BackgroundField({ value, onChange }: { value: string | null; onChange(value: string | null): void }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={id}
        className="relative size-control-md shrink-0 cursor-pointer overflow-hidden rounded-md border border-line hover:border-line-strong"
        style={{ background: value ?? "var(--color-canvas)" }}
        title={t("newProject.background")}
      >
        <input
          id={id}
          type="color"
          value={value ?? themeBackground()}
          onChange={(e) => onChange(parseHexColor(e.target.value))}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={t("newProject.background")}
        />
      </label>
      <span className="text-sm text-muted tabular">{value ?? t("newProject.backgroundNone")}</span>
      {value !== null && (
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          {t("newProject.backgroundReset")}
        </Button>
      )}
    </div>
  );
}

/** Native colour inputs need a resolved colour; the theme remains the source. */
export function themeBackground(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--color-canvas").trim();
}
