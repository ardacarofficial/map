import { editGate, manualEditAllowed } from "../agent/editGate";
/**
 * Command registry. A command is something the user can do; shortcuts
 * (`shortcuts.ts`), the command palette, toolbar buttons and menus all run
 * commands by id, so one action has exactly one implementation.
 */
import type { MessageKey } from "../i18n";
import { effectiveShortcuts, shortcutsRevision, type CommandId } from "../shortcuts/shortcuts";
import { findBinding, parseChord, type KeyChord, type KeyEventLike } from "./keymap";

export type CommandCategory = "file" | "edit" | "view" | "tool" | "layer" | "map" | "tileset" | "entity" | "level" | "general";

export interface Command {
  id: CommandId;
  title: MessageKey;
  category: CommandCategory;
  run(): void;
  /** When false the command does nothing and is hidden from the palette. Defaults to true. */
  enabled?(): boolean;
  /** Set false to keep the command out of the palette (e.g. the palette itself). */
  inPalette?: boolean;
  /** On / off state of a toggle command (menus show it as a check mark). */
  checked?(): boolean;
}

const commands = new Map<CommandId, Command>();

export function registerCommands(list: readonly Command[]): void {
  for (const command of list) commands.set(command.id, command);
}

export function getCommand(id: CommandId): Command | undefined {
  return commands.get(id);
}

export function allCommands(): Command[] {
  return [...commands.values()];
}

export function commandAllowedDuringEdit(command: Command): boolean {
  return command.id.startsWith("ai.") || command.category === "view" || command.category === "general" || command.category === "tool" || ["file.save", "file.saveAs", "file.close", "file.new", "file.open", "level.next", "level.previous", "edit.copy"].includes(command.id);
}

export function isEnabled(command: Command): boolean {
  if (editGate.blocked && !commandAllowedDuringEdit(command)) return false;
  return command.enabled?.() ?? true;
}

/**
 * A palette-only entry generated at open time (e.g. "Level'a git: Zindan"
 * for each level). Not bindable to a key; `prefix` is shown quieter.
 */
export interface PaletteEntry {
  /** Unique among entries (also used as the React key). */
  key: string;
  prefix: string;
  title: string;
  run(): void;
}

const paletteProviders = new Set<() => PaletteEntry[]>();
let paletteProvidersRevision = 0;
const paletteProviderListeners = new Set<() => void>();
/** Async view settings can arrive while the palette is already open. */
export function notifyPaletteEntriesChanged(): void { paletteProvidersRevision++; for (const listener of paletteProviderListeners) listener(); }
export function paletteEntriesVersion(): number { return paletteProvidersRevision; }
export function subscribePaletteEntries(listener: () => void): () => void { paletteProviderListeners.add(listener); return () => { paletteProviderListeners.delete(listener); }; }


/** Adds a source of dynamic palette entries. Returns an unregister function. */
export function registerPaletteProvider(provider: () => PaletteEntry[]): () => void {
  paletteProviders.add(provider);
  notifyPaletteEntriesChanged();
  return () => { paletteProviders.delete(provider); notifyPaletteEntriesChanged(); };
}

/** Every dynamic palette entry available right now. */
export function paletteEntries(): PaletteEntry[] {
  return [...paletteProviders].flatMap((provider) => provider());
}

/** Runs a command if it exists and is enabled. Returns true when it ran. */
export function runCommand(id: CommandId): boolean {
  const command = commands.get(id);
  if (command && editGate.blocked && !commandAllowedDuringEdit(command)) { manualEditAllowed(); return false; }
  if (!command || !isEnabled(command)) return false;
  command.run();
  return true;
}

interface Binding {
  command: CommandId;
  chord: KeyChord;
  scope?: "tileset" | undefined;
}

let bindings: Binding[] | null = null;
let bindingsRevision = -1;

/** All key bindings, parsed from `SHORTCUTS` + settings overrides (re-parsed when those change). */
function allBindings(): Binding[] {
  if (bindings === null || bindingsRevision !== shortcutsRevision()) {
    bindingsRevision = shortcutsRevision();
    bindings = effectiveShortcuts().flatMap((s) => s.keys.map((keys) => ({ command: s.command, chord: parseChord(keys), scope: s.scope })));
  }
  return bindings;
}

/** The command bound to this key event, if any. */
export function commandForEvent(event: KeyEventLike, scope?: "tileset"): CommandId | null {
  const focusedScope = scope ?? (typeof document !== "undefined" && document.activeElement?.closest("[data-tileset-library], [data-tileset-dock], [data-panel-tab=tileset]") ? "tileset" : undefined);
  if (focusedScope) {
    const contextual = findBinding(event, allBindings().filter(b => b.scope === focusedScope));
    if (contextual) return contextual.command;
  }
  return findBinding(event, allBindings().filter(b => !b.scope))?.command ?? null;
}
