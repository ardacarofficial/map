/**
 * Applies the settings file (language + shortcut overrides) and keeps the UI
 * in step with it. The React root subscribes to `revision`, so a language or
 * key change re-renders every panel without remounting the canvas.
 */
import { create } from "zustand";
import { onLayoutCommit, useDockStore } from "../ui/layout/dockStore";
import type { DockLayout } from "../ui/layout/dockModel";
import { mergeLayoutSettings, SettingsWriteQueue } from "./layoutSettings";

import { getLocale, isAvailableLocale, setLocale, subscribeLocale, t, type Locale, type MessageKey } from "../i18n";
import { setShortcutOverrides, SHORTCUTS } from "../shortcuts/shortcuts";
import { toast } from "../ui/toast/toastStore";
import { getPlatform } from "./index";
import { compactSettingsText, defaultSettingsText, parseSettings, withLocale, type SettingsProblem } from "./settings";

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
let settingsPreview = 0;
let previewSequence = 0;

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
  layout: "docking.invalidLayout",
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

// Direct setLocale() calls (including draft preview) refresh the same root revision.
subscribeLocale(bump);

/**
 * Parses and applies settings text. Invalid entries are logged and shown in
 * one toast, then ignored. Returns the problems.
 */
export function applySettingsText(text: string, applyLayout = true): SettingsProblem[] {
  appliedText = text;
  const { settings, problems } = parseSettings(text, SHORTCUTS, getLocale());
  if (applyLayout && settings.layout) useDockStore.getState().applyExternal(settings.layout);
  const previousLocale = getLocale();
  setShortcutOverrides(settings.shortcuts);
  applyLocale(settings.locale);
  if (getLocale() === previousLocale) bump();
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
 * created with the locale and an empty shortcut override set.
 */
async function readAppSettings(): Promise<void> {
  const revision = useDockStore.getState().revision;
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
      const defaults = mergeLayoutSettings(null, useDockStore.getState().layout, defaultSettingsText(SHORTCUTS, getLocale()))!;
      try {
        await platform.writeSettings(defaults);
        appliedText = defaults;
      } catch (error) {
        platform.log("warn", `settings: could not write defaults: ${String(error)}`);
      }
    }
    return;
  }
  applySettingsText(text, revision === useDockStore.getState().revision);
}

/** Re-reads the settings when they changed outside (edited in a text editor). */
export async function reloadAppSettingsIfChanged(): Promise<void> {
  if (settingsPreview || useAppSettings.getState().dialogOpen) return;
  await settingsWrites.idle();
  if (settingsPreview || useAppSettings.getState().dialogOpen) return;
  let text: string | null;
  try {
    text = await getPlatform().readSettings();
  } catch {
    return;
  }
  if (settingsPreview || useAppSettings.getState().dialogOpen || text === null || text === appliedText) return;
  const problems = applySettingsText(text);
  if (problems.length === 0) toast.info(t("settings.reloaded"));
}

/** Switches the UI language and stores it in the settings. */
export async function setAppLocale(locale: Locale): Promise<void> {
  locale = isAvailableLocale(locale) ? locale : "tr";
  if (locale === getLocale()) return;
  applyLocale(locale);
  const platform = getPlatform();
  try {
    const next = await settingsWrites.update(raw => withLocale(raw, locale, SHORTCUTS));
    if (next === null) {
      toast.warning(t("settings.notSaved"));
      return;
    }
    appliedText = next;
  } catch (error) {
    platform.log("warn", `settings: could not save language: ${String(error)}`);
  }
}

/** Saves the text from the settings dialog and applies it. Throws `SyntaxError` for invalid JSON. */
export async function saveSettingsText(text: string): Promise<SettingsProblem[]> {
  text = compactSettingsText(text, SHORTCUTS);
  await settingsWrites.update(() => text);
  return applySettingsText(text);
}

/** Reloads the settings when the window regains focus. Returns an uninstall function. */
export function installSettingsReload(): () => void {
  const onFocus = () => void reloadAppSettingsIfChanged();
  window.addEventListener("focus", onFocus);
  return () => window.removeEventListener("focus", onFocus);
}

// Docking writes share the locale/dialog queue. Rapid resize/drop commits are
// coalesced, and each merge preserves fields edited by another settings writer.
const settingsWrites = new SettingsWriteQueue(
  () => getPlatform().readSettings(),
  async text => { await getPlatform().writeSettings(text); appliedText = text; },
);
let pendingLayout: DockLayout | null = null;
let writingLayout = false;
let reportedLayoutFailure = false;
async function storeLayout(layout: DockLayout): Promise<void> {
  if (settingsPreview || getPlatform().kind !== "desktop") return;
  pendingLayout = layout;
  if (writingLayout) return;
  writingLayout = true;
  try {
    while (pendingLayout) {
      const next = await settingsWrites.update(raw => {
        const latest = pendingLayout!;
        pendingLayout = null;
        return mergeLayoutSettings(raw, latest, defaultSettingsText(SHORTCUTS, getLocale()));
      });
      if (next === null) throw new Error("invalid settings file");
    }
  } catch (error) {
    if (!reportedLayoutFailure) {
      reportedLayoutFailure = true;
      getPlatform().log("warn", `layout: ${String(error)}`);
      toast.warning(t("docking.saveFailed"));
    }
  } finally {
    writingLayout = false;
    if (pendingLayout) void storeLayout(pendingLayout);
  }
}
export async function loadAppSettings(): Promise<void> {
  const revision = useDockStore.getState().revision;
  try { await readAppSettings(); }
  finally {
    onLayoutCommit(layout => { void storeLayout(layout); });
    if (useDockStore.getState().revision !== revision) void storeLayout(useDockStore.getState().layout);
  }
}

/** A modal preview owns the live dock until save succeeds or cancellation restores it. */
export async function beginSettingsPreview() {
  const token = ++previewSequence;
  settingsPreview = token;
  const layout = useDockStore.getState().layout;
  const locale = getLocale();
  let finished = false;
  const cancel = () => {
    if (finished || settingsPreview !== token) return;
    finished = true;
    useDockStore.getState().applyExternal(layout);
    setLocale(locale);
    settingsPreview = 0;
  };
  try {
    await settingsWrites.idle();
    const text = await readSettingsText();
    return { text, cancel, async save(text: string) {
      const raw: unknown = JSON.parse(text);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SyntaxError("Expected a JSON object");
      const problems = await saveSettingsText(text);
      finished = true;
      settingsPreview = 0;
      return problems;
    } };
  } catch (error) { cancel(); throw error; }
}
