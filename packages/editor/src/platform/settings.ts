/**
 * The user's settings file (CLAUDE.md v0.5: "Kısayollar ayar dosyasından
 * değiştirilebilir; ayrı ekran yok"). Pure parsing / validation / merging;
 * `appSettings.ts` applies the result.
 *
 * ```json
 * {
 *   "locale": "tr",
 *   "shortcuts": { "tool.brush": ["B"], "edit.redo": ["Ctrl+Y", "Ctrl+Shift+Z"] }
 * }
 * ```
 *
 * A command listed under `shortcuts` gets exactly the given keys (`[]`
 * unbinds it); commands not listed keep their defaults. Invalid entries are
 * reported and ignored, never fatal.
 */
import { parseChord } from "../commands/keymap";
import type { Locale } from "../i18n";
import type { CommandId, ShortcutDef } from "../shortcuts/shortcuts";

export const LOCALES: readonly Locale[] = ["tr", "en"];

export interface AppSettings {
  locale: Locale;
  /** Validated overrides only. */
  shortcuts: Map<CommandId, string[]>;
}

/** One ignored entry. `entry` is the JSON path ("shortcuts.tool.brush"). */
export interface SettingsProblem {
  entry: string;
  reason: "json" | "notObject" | "locale" | "unknownCommand" | "notKeyList" | "badKey" | "fixedKey" | "conflict" | "unknownField";
  detail: string;
}

export interface ParsedSettings {
  settings: AppSettings;
  problems: SettingsProblem[];
}

/** Bound by the canvas itself (held while dragging), so not remappable here. */
const FIXED_COMMANDS: ReadonlySet<CommandId> = new Set<CommandId>(["view.pan"]);

const NAMED_CODES = new Set([
  "Space", "Tab", "Escape", "Enter", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Equal", "Minus", "Comma", "Period", "Slash", "Backslash", "Semicolon", "Quote", "Backquote", "BracketLeft", "BracketRight",
  "NumpadAdd", "NumpadSubtract", "NumpadMultiply", "NumpadDivide", "NumpadDecimal", "NumpadEnter",
]);

const MODIFIERS = new Set(["ctrl", "cmd", "meta", "shift", "alt"]);

/** True for key strings `keymap.parseChord` understands ("B", "Ctrl+Shift+P", "F2", "Ctrl+Digit0"). */
export function isValidKeyString(keys: string): boolean {
  if (keys.trim() !== keys || keys.length === 0) return false;
  const parts = keys.split("+");
  const key = parts.pop() ?? "";
  const mods = parts.map((p) => p.toLowerCase());
  if (mods.some((m) => !MODIFIERS.has(m)) || new Set(mods).size !== mods.length) return false;
  if (/^[A-Za-z0-9]$/.test(key)) return true;
  if (/^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-9]|2[0-4]))$/.test(key)) return true;
  return NAMED_CODES.has(key);
}

function chordId(keys: string): string {
  return JSON.stringify(parseChord(keys));
}

/**
 * Parses the settings text. Never throws: unreadable JSON gives the defaults
 * plus one problem; every bad entry is dropped with a problem.
 */
export function parseSettings(text: string, defaults: readonly ShortcutDef[], fallbackLocale: Locale = "tr"): ParsedSettings {
  const problems: SettingsProblem[] = [];
  const settings: AppSettings = { locale: fallbackLocale, shortcuts: new Map() };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    problems.push({ entry: "", reason: "json", detail: error instanceof Error ? error.message : String(error) });
    return { settings, problems };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    problems.push({ entry: "", reason: "notObject", detail: "expected an object" });
    return { settings, problems };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "locale" && key !== "shortcuts" && !key.startsWith("$")) {
      problems.push({ entry: key, reason: "unknownField", detail: key });
    }
  }

  if ("locale" in record) {
    const locale = record.locale;
    if (typeof locale === "string" && (LOCALES as readonly string[]).includes(locale)) settings.locale = locale as Locale;
    else problems.push({ entry: "locale", reason: "locale", detail: JSON.stringify(locale) });
  }

  const known = new Set<string>(defaults.map((d) => d.command));
  const shortcuts = record.shortcuts;
  if (shortcuts !== undefined) {
    if (typeof shortcuts !== "object" || shortcuts === null || Array.isArray(shortcuts)) {
      problems.push({ entry: "shortcuts", reason: "notObject", detail: "expected an object" });
    } else {
      for (const [command, value] of Object.entries(shortcuts as Record<string, unknown>)) {
        const entry = `shortcuts.${command}`;
        if (!known.has(command)) {
          problems.push({ entry, reason: "unknownCommand", detail: command });
          continue;
        }
        if (FIXED_COMMANDS.has(command as CommandId)) {
          problems.push({ entry, reason: "fixedKey", detail: command });
          continue;
        }
        const list = typeof value === "string" ? [value] : value;
        if (!Array.isArray(list) || list.some((k) => typeof k !== "string")) {
          problems.push({ entry, reason: "notKeyList", detail: JSON.stringify(value) });
          continue;
        }
        const keys: string[] = [];
        for (const k of list as string[]) {
          if (isValidKeyString(k)) {
            if (!keys.some((existing) => chordId(existing) === chordId(k))) keys.push(k);
          } else problems.push({ entry, reason: "badKey", detail: k });
        }
        // All keys bad → keep the defaults rather than silently unbinding.
        if (keys.length === 0 && (list as string[]).length > 0) continue;
        settings.shortcuts.set(command as CommandId, keys);
      }
    }
  }

  dropConflicts(settings.shortcuts, defaults, problems);
  return { settings, problems };
}

/**
 * Removes overridden keys that end up on two commands. A default binding wins
 * over an override; between two overrides the one listed first wins.
 */
function dropConflicts(overrides: Map<CommandId, string[]>, defaults: readonly ShortcutDef[], problems: SettingsProblem[]): void {
  const owner = new Map<string, CommandId>();
  for (const def of defaults) {
    if (overrides.has(def.command)) continue;
    for (const k of def.keys) if (!owner.has(chordId(k))) owner.set(chordId(k), def.command);
  }
  for (const [command, keys] of overrides) {
    const kept: string[] = [];
    for (const k of keys) {
      const other = owner.get(chordId(k));
      if (other && other !== command) {
        problems.push({ entry: `shortcuts.${command}`, reason: "conflict", detail: `${k} → ${other}` });
        continue;
      }
      owner.set(chordId(k), command);
      kept.push(k);
    }
    overrides.set(command, kept);
  }
}

/** `defaults` with `overrides` applied (the effective shortcut list). */
export function mergeShortcuts(defaults: readonly ShortcutDef[], overrides: ReadonlyMap<CommandId, readonly string[]>): ShortcutDef[] {
  return defaults.map((d) => {
    const keys = overrides.get(d.command);
    return keys ? { command: d.command, keys: [...keys] } : d;
  });
}

/**
 * The file written on first run: every command with its current keys, so the
 * user edits values instead of guessing command ids (JSON has no comments).
 */
export function defaultSettingsText(defaults: readonly ShortcutDef[], locale: Locale): string {
  const shortcuts: Record<string, string[]> = {};
  for (const d of defaults) if (!FIXED_COMMANDS.has(d.command)) shortcuts[d.command] = [...d.keys];
  return formatSettings({ locale, shortcuts });
}

/**
 * Pretty JSON with one line per shortcut (`"tool.brush": ["B"],`), so the
 * file reads like a table. Other values use plain 2-space JSON.
 */
export function formatSettings(settings: Record<string, unknown>): string {
  const indent = (text: string) => text.replace(/\n/g, "\n  ");
  const lines = Object.entries(settings).map(([key, value]) => {
    if (key === "shortcuts" && typeof value === "object" && value !== null && !Array.isArray(value)) {
      const rows = Object.entries(value as Record<string, unknown>).map(([command, keys]) =>
        Array.isArray(keys)
          ? `    ${JSON.stringify(command)}: [${keys.map((k) => JSON.stringify(k)).join(", ")}]`
          : `    ${JSON.stringify(command)}: ${indent(indent(JSON.stringify(keys, null, 2)))}`,
      );
      return rows.length === 0 ? `  "shortcuts": {}` : `  "shortcuts": {\n${rows.join(",\n")}\n  }`;
    }
    return `  ${JSON.stringify(key)}: ${indent(JSON.stringify(value, null, 2))}`;
  });
  return lines.length === 0 ? "{}\n" : `{\n${lines.join(",\n")}\n}\n`;
}

/**
 * Sets `locale` in the user's settings text, keeping everything else.
 * `null` text (no file yet) gives the defaults with that locale. Returns
 * `null` for text that is not a JSON object: the user's broken file is not
 * overwritten.
 */
export function withLocale(text: string | null, locale: Locale, defaults: readonly ShortcutDef[]): string | null {
  if (text === null || text.trim() === "") return defaultSettingsText(defaults, locale);
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      return formatSettings({ ...(raw as Record<string, unknown>), locale });
    }
  } catch {
    // Broken file: leave it to the user.
  }
  return null;
}
