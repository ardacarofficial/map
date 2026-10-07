/**
 * Command registry. A command is something the user can do; shortcuts
 * (`shortcuts.ts`), the command palette, toolbar buttons and menus all run
 * commands by id, so one action has exactly one implementation.
 */
import type { MessageKey } from "../i18n";
import { SHORTCUTS, type CommandId } from "../shortcuts/shortcuts";
import { matchesChord, parseChord, type KeyChord, type KeyEventLike } from "./keymap";

export type CommandCategory = "file" | "edit" | "view" | "tool" | "layer" | "map" | "tileset" | "general";

export interface Command {
  id: CommandId;
  title: MessageKey;
  category: CommandCategory;
  run(): void;
  /** When false the command does nothing and is hidden from the palette. Defaults to true. */
  enabled?(): boolean;
  /** Set false to keep the command out of the palette (e.g. the palette itself). */
  inPalette?: boolean;
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

export function isEnabled(command: Command): boolean {
  return command.enabled?.() ?? true;
}

/** Runs a command if it exists and is enabled. Returns true when it ran. */
export function runCommand(id: CommandId): boolean {
  const command = commands.get(id);
  if (!command || !isEnabled(command)) return false;
  command.run();
  return true;
}

interface Binding {
  command: CommandId;
  chord: KeyChord;
}

let bindings: Binding[] | null = null;

/** All key bindings, parsed once from `SHORTCUTS`. */
function allBindings(): Binding[] {
  bindings ??= SHORTCUTS.flatMap((s) => s.keys.map((keys) => ({ command: s.command, chord: parseChord(keys) })));
  return bindings;
}

/** The command bound to this key event, if any. */
export function commandForEvent(event: KeyEventLike): CommandId | null {
  return allBindings().find((b) => matchesChord(event, b.chord))?.command ?? null;
}
