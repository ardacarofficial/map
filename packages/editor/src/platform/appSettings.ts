/**
 * Applies the settings file (language + shortcut overrides) and keeps the UI
 * in step with it. The React root subscribes to `revision`, so a language or
 * key change re-renders every panel without remounting the canvas.
 */
import { create } from "zustand";

import { getLocale, setLocale, t, type Locale, type MessageKey } from "../i18n";
import { setShortcutOverrides, SHORTCUTS } from "../shortcuts/shortcuts";
import { toast } from "../ui/toast/toastStore";
import { getPlatform } from "./index";
import { defaultSettingsText, parseSettings, withLocale, type SettingsProblem } from "./settings";

interface AppSettingsState {
  locale: Locale;
  /** Bumped whenever the language or the key bindings change. */
  revision: number;
  /** The settings-file dialog is open. */
  dialogOpen: boolean;
  setDialogOpen(open: boolean): void;
}

export const useAppSettings = create<AppSettingsState>()((set) => ({
  locale: getLocale(),
  revision: 0,
  dialogOpen: false,
  setDialogOpen: (dialogOpen) => set({ dialogOpen }),
}));

/** The settings text we last applied (focus reload skips unchanged files). */
let appliedText: string | null = null;

const REASON_KEYS: Record<SettingsProblem["reason"], MessageKey> = {
  json: "settings.reasonJson",
  notObject: "settings.reasonNotObject",
  locale: "settings.reasonLocale",
  unknownCommand: "settings.reasonUnknownCommand",
  notKeyList: "settings.reasonNotKeyList",
  badKey: "settings.reasonBadKey",
  fixedKey: "settings.reasonFixedKey",
  conflict: "settings.reasonConflict",
  unknownField: "settings.reasonUnknownField",
};

/** Human-readable text for one ignored settings entry (UI language). */
export function describeProblem(problem: SettingsProblem): string {
  return t(REASON_KEYS[problem.reason], { entry: problem.entry || "settings", detail: problem.detail });
}

function applyLocale(locale: Locale): void {
  if (locale !== getLocale()) setLocale(locale);
}

function bump(): void {
  useAppSettings.setState((s) => ({ locale: getLocale(), revision: s.revision + 1 }));
}

/**
 * Parses and applies settings text. Invalid entries are logged and shown in
 * one toast, then ignored. Returns the problems.
 */
export function applySettingsText(text: string): SettingsProblem[] {
  appliedText = text;
  const { settings, problems } = parseSettings(text, SHORTCUTS, getLocale());
  applyLocale(settings.locale);
  setShortcutOverrides(settings.shortcuts);
  bump();
  if (problems.length > 0) {
    const messages = problems.map(describeProblem);
    for (const message of messages) getPlatform().log("warn", `settings: ${message}`);
    toast.warning(t("settings.problems", { count: problems.length, first: messages[0] ?? "" }));
  }
  return problems;
}

/** The current settings text, or the defaults when none is stored. */
export async function readSettingsText(): Promise<string> {
  return (await getPlatform().readSettings()) ?? defaultSettingsText(SHORTCUTS, getLocale());
}

/**
 * Startup: reads and applies the settings. On the desktop a missing file is
 * created with every command's current keys (so the user can edit values).
 */
export async function loadAppSettings(): Promise<void> {
  const platform = getPlatform();
  let text: string | null;
  try {
    text = await platform.readSettings();
  } catch (error) {
    platform.log("error", `settings: ${String(error)}`);
    toast.error(t("settings.unreadable", { detail: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (text === null) {
    appliedText = null;
    if (platform.kind === "desktop") {
      const defaults = defaultSettingsText(SHORTCUTS, getLocale());
      try {
        await platform.writeSettings(defaults);
        appliedText = defaults;
      } catch (error) {
        platform.log("warn", `settings: could not write defaults: ${String(error)}`);
      }
    }
    return;
  }
  applySettingsText(text);
}

/** Re-reads the settings when they changed outside (edited in a text editor). */
export async function reloadAppSettingsIfChanged(): Promise<void> {
  let text: string | null;
  try {
    text = await getPlatform().readSettings();
  } catch {
    return;
  }
  if (text === null || text === appliedText) return;
  const problems = applySettingsText(text);
  if (problems.length === 0) toast.info(t("settings.reloaded"));
}

/** Switches the UI language and stores it in the settings. */
export async function setAppLocale(locale: Locale): Promise<void> {
  if (locale === getLocale()) return;
  applyLocale(locale);
  bump();
  const platform = getPlatform();
  try {
    const next = withLocale(await platform.readSettings(), locale, SHORTCUTS);
    if (next === null) {
      toast.warning(t("settings.notSaved"));
      return;
    }
    await platform.writeSettings(next);
    appliedText = next;
  } catch (error) {
    platform.log("warn", `settings: could not save language: ${String(error)}`);
  }
}

/** Saves the text from the settings dialog and applies it. Throws `SyntaxError` for invalid JSON. */
export async function saveSettingsText(text: string): Promise<SettingsProblem[]> {
  JSON.parse(text);
  await getPlatform().writeSettings(text);
  return applySettingsText(text);
}

/** Reloads the settings when the window regains focus. Returns an uninstall function. */
export function installSettingsReload(): () => void {
  const onFocus = () => void reloadAppSettingsIfChanged();
  window.addEventListener("focus", onFocus);
  return () => window.removeEventListener("focus", onFocus);
}
