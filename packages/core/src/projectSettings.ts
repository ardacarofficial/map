/**
 * Project settings (round 4): defaults for new levels and export options,
 * saved in `project.smap` as an optional `settings` object. Only values
 * that differ from {@link DEFAULT_PROJECT_SETTINGS} are written, in a fixed
 * key order, so a project with default settings has no `settings` key and
 * old files read unchanged (`documentFormatVersion` stays 1).
 *
 * Settings are plain project data (like the level list): not part of a
 * level's undo history. The editor keeps the current value and saves it
 * with `serializeProject`.
 */

/** Kind of layer a template creates. `collision` = collision grid layer. */
export type LayerTemplateKind = "tile" | "collision" | "entity";

export interface LayerTemplateEntry {
  readonly name: string;
  readonly kind: LayerTemplateKind;
}

export interface ProjectSettings {
  /** Tile size of new levels, pixels. */
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** Size of new levels, cells. */
  readonly newLevel: { readonly width: number; readonly height: number };
  /** Layers of a new level, bottom to top. Empty = the editor's default (one tile layer). */
  readonly layerTemplate: readonly LayerTemplateEntry[];
  /** Default canvas background `#rrggbb` for levels without their own, or `null` (theme colour). */
  readonly background: string | null;
  readonly unity: {
    /** Unity project folder to export into (a hint shown in the export dialog), `""` when unset. */
    readonly folderHint: string;
    /** Export to Unity on every save. */
    readonly exportOnSave: boolean;
  };
}

/** Input form: every field optional (missing → default). */
export interface ProjectSettingsInput {
  readonly tileWidth?: number;
  readonly tileHeight?: number;
  readonly newLevel?: { readonly width?: number; readonly height?: number };
  readonly layerTemplate?: readonly LayerTemplateEntry[];
  readonly background?: string | null;
  readonly unity?: { readonly folderHint?: string; readonly exportOnSave?: boolean };
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = Object.freeze({
  tileWidth: 32,
  tileHeight: 32,
  newLevel: Object.freeze({ width: 64, height: 48 }),
  layerTemplate: Object.freeze([]),
  background: null,
  unity: Object.freeze({ folderHint: "", exportOnSave: false }),
});

/** Largest tile side accepted in settings. */
export const MAX_SETTINGS_TILE_SIZE = 1024;
/** Largest new-level side (same as `MAX_MAP_SIZE`). */
const MAX_LEVEL_SIDE = 4096;

const LAYER_KINDS: readonly LayerTemplateKind[] = ["tile", "collision", "entity"];
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** True for a `#rrggbb` colour (either case). */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && COLOR_RE.test(value);
}

/** `#rrggbb` in lowercase. @throws RangeError when `value` is not a `#rrggbb` colour. */
export function normalizeHexColor(value: string): string {
  if (!isHexColor(value)) throw new RangeError(`colour must be "#rrggbb", got ${JSON.stringify(value)}`);
  return value.toLowerCase();
}

/**
 * Full, frozen settings from partial input (missing → default; colours
 * lowercased). Idempotent.
 * @throws RangeError / TypeError naming the bad field.
 */
export function normalizeProjectSettings(input: ProjectSettingsInput = {}): ProjectSettings {
  if (typeof input !== "object" || input === null) throw new TypeError("settings must be an object");
  const d = DEFAULT_PROJECT_SETTINGS;
  const int = (v: unknown, name: string, min: number, max: number, def: number): number => {
    if (v === undefined) return def;
    if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw new RangeError(`settings.${name} must be an integer in [${min}, ${max}]`);
    return v as number;
  };
  const tileWidth = int(input.tileWidth, "tileWidth", 1, MAX_SETTINGS_TILE_SIZE, d.tileWidth);
  const tileHeight = int(input.tileHeight, "tileHeight", 1, MAX_SETTINGS_TILE_SIZE, d.tileHeight);
  const nl = input.newLevel ?? {};
  if (typeof nl !== "object" || nl === null) throw new TypeError("settings.newLevel must be an object");
  const newLevel = Object.freeze({
    width: int(nl.width, "newLevel.width", 1, MAX_LEVEL_SIDE, d.newLevel.width),
    height: int(nl.height, "newLevel.height", 1, MAX_LEVEL_SIDE, d.newLevel.height),
  });
  const template = input.layerTemplate ?? [];
  if (!Array.isArray(template)) throw new TypeError("settings.layerTemplate must be an array");
  const layerTemplate = Object.freeze(
    template.map((entry: LayerTemplateEntry, i: number) => {
      if (typeof entry !== "object" || entry === null) throw new TypeError(`settings.layerTemplate[${i}] must be an object`);
      if (typeof entry.name !== "string" || entry.name.trim().length === 0) throw new TypeError(`settings.layerTemplate[${i}].name must be a non-empty string`);
      if (!LAYER_KINDS.includes(entry.kind)) throw new RangeError(`settings.layerTemplate[${i}].kind must be one of ${LAYER_KINDS.join(", ")}`);
      return Object.freeze({ name: entry.name, kind: entry.kind });
    }),
  );
  const names = new Set(layerTemplate.map((e) => e.name));
  if (names.size !== layerTemplate.length) throw new RangeError("settings.layerTemplate names must be unique");
  let background: string | null = d.background;
  if (input.background !== undefined && input.background !== null) {
    if (!isHexColor(input.background)) throw new RangeError('settings.background must be "#rrggbb" or null');
    background = input.background.toLowerCase();
  }
  const u = input.unity ?? {};
  if (typeof u !== "object" || u === null) throw new TypeError("settings.unity must be an object");
  if (u.folderHint !== undefined && typeof u.folderHint !== "string") throw new TypeError("settings.unity.folderHint must be a string");
  if (u.exportOnSave !== undefined && typeof u.exportOnSave !== "boolean") throw new TypeError("settings.unity.exportOnSave must be a boolean");
  const unity = Object.freeze({ folderHint: u.folderHint ?? d.unity.folderHint, exportOnSave: u.exportOnSave ?? d.unity.exportOnSave });
  return Object.freeze({ tileWidth, tileHeight, newLevel, layerTemplate, background, unity });
}

/**
 * The non-default part of `settings` as JSON-ready data in the fixed key
 * order `tileWidth, tileHeight, newLevel{width, height}, layerTemplate,
 * background, unity{folderHint, exportOnSave}` (inside `newLevel` / `unity`
 * only the differing keys), or `null` when everything is default.
 */
export function projectSettingsJson(settings: ProjectSettings): Record<string, unknown> | null {
  const s = normalizeProjectSettings(settings);
  const d = DEFAULT_PROJECT_SETTINGS;
  const out: Record<string, unknown> = {};
  if (s.tileWidth !== d.tileWidth) out["tileWidth"] = s.tileWidth;
  if (s.tileHeight !== d.tileHeight) out["tileHeight"] = s.tileHeight;
  const nl: Record<string, unknown> = {};
  if (s.newLevel.width !== d.newLevel.width) nl["width"] = s.newLevel.width;
  if (s.newLevel.height !== d.newLevel.height) nl["height"] = s.newLevel.height;
  if (Object.keys(nl).length > 0) out["newLevel"] = nl;
  if (s.layerTemplate.length > 0) out["layerTemplate"] = s.layerTemplate.map((e) => ({ name: e.name, kind: e.kind }));
  if (s.background !== null) out["background"] = s.background;
  const u: Record<string, unknown> = {};
  if (s.unity.folderHint !== d.unity.folderHint) u["folderHint"] = s.unity.folderHint;
  if (s.unity.exportOnSave !== d.unity.exportOnSave) u["exportOnSave"] = s.unity.exportOnSave;
  if (Object.keys(u).length > 0) out["unity"] = u;
  return Object.keys(out).length > 0 ? out : null;
}
