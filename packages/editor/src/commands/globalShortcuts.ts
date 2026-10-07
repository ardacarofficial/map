/**
 * The one global keydown handler: maps `SHORTCUTS` → registered commands.
 *
 * - "Ctrl" matches Ctrl or Cmd.
 * - Shortcuts without Ctrl are ignored while typing in a text field.
 * - `Tab` toggles panels only while the canvas host has focus (CLAUDE.md →
 *   Arayüz); elsewhere it keeps moving focus.
 * - `Space` (pan) belongs to the canvas and is never consumed here.
 */
import { CANVAS_HOST_ATTR } from "../ui/canvas/canvasHandle";
import { getCommand, commandForEvent, runCommand } from "./registry";
import type { CommandId } from "../shortcuts/shortcuts";
import { modalOpen } from "./modal";

/** Commands that make sense to auto-repeat while a key is held. */
const REPEATABLE = new Set<CommandId>(["view.zoomIn", "view.zoomOut"]);

/** Commands that still work while a modal dialog is open. */
const ALLOWED_IN_MODAL = new Set<CommandId>(["palette.open"]);

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(target.type);
  }
  return false;
}

export function isCanvasFocused(): boolean {
  const active = document.activeElement;
  return active instanceof Element && active.closest(`[${CANVAS_HOST_ATTR}]`) !== null;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return;
  const id = commandForEvent(event);
  if (!id || id === "view.pan") return;
  const command = getCommand(id);
  if (!command) return;

  const withCtrl = event.ctrlKey || event.metaKey;
  if (!withCtrl && isTypingTarget(event.target)) return;
  if (id === "view.togglePanels" && !isCanvasFocused()) return;

  // From here the key is ours: keep the browser from saving the page, opening
  // its find bar, zooming, etc.
  event.preventDefault();
  if (event.repeat && !REPEATABLE.has(id)) return;
  if (modalOpen() && !ALLOWED_IN_MODAL.has(id)) return;
  runCommand(id);
}

/** Installs the handler; returns an uninstall function. */
export function installGlobalShortcuts(): () => void {
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
