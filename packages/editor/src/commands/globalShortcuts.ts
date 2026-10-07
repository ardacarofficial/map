/**
 * The one global keydown handler: maps `SHORTCUTS` → registered commands.
 *
 * - "Ctrl" matches Ctrl or Cmd.
 * - Shortcuts without Ctrl are ignored while typing in a text field.
 * - `Tab` toggles panels only while the canvas host has focus (CLAUDE.md →
 *   Arayüz); elsewhere it keeps moving focus.
 * - `Space` (pan) belongs to the canvas and is never consumed here.
 * - Clipboard / undo shortcuts belong to a text field while typing in one,
 *   and fall through to the browser when the command has nothing to do.
 * - `Ctrl+V` is handled by the native `paste` event (it carries the system
 *   clipboard text without a permission prompt).
 * - `Escape` that closes a dialog does not also deselect.
 */
import { CANVAS_HOST_ATTR } from "../ui/canvas/canvasHandle";
import { useEditorStore } from "../state/editorStore";
import { pasteText } from "./clipboard";
import { getCommand, commandForEvent, isEnabled, runCommand } from "./registry";
import type { CommandId } from "../shortcuts/shortcuts";
import { modalOpen } from "./modal";

/** Commands that make sense to auto-repeat while a key is held. */
const REPEATABLE = new Set<CommandId>(["view.zoomIn", "view.zoomOut", "edit.undo", "edit.redo"]);

/** Commands that a focused text field handles itself (native undo, copy, select all...). */
const TEXT_COMMANDS = new Set<CommandId>([
  "edit.undo",
  "edit.redo",
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.selectAll",
  "edit.delete",
]);

/**
 * When Ctrl+V went down. Paste events without it are ignored: on Linux a
 * middle click (our pan button) pastes the primary selection.
 */
let pasteKeyAt = -Infinity;

/** Modal state when the key went down, before any dialog reacted to it. */
let modalAtKeyDown = false;

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
  const typing = isTypingTarget(event.target);
  if (typing && (!withCtrl || TEXT_COMMANDS.has(id))) return;
  if (id === "view.togglePanels" && !isCanvasFocused()) return;
  const modal = modalOpen() || modalAtKeyDown;
  if (id === "edit.paste" && !modal) {
    pasteKeyAt = performance.now();
    return; // → onPaste
  }
  // Nothing to copy/undo here: leave the key to the browser (e.g. copying toast text).
  if (TEXT_COMMANDS.has(id) && !isEnabled(command)) return;

  // From here the key is ours: keep the browser from saving the page, opening
  // its find bar, zooming, etc.
  event.preventDefault();
  if (event.repeat && !REPEATABLE.has(id)) return;
  if (modal && !ALLOWED_IN_MODAL.has(id)) return;
  runCommand(id);
}

function onKeyDownCapture(): void {
  modalAtKeyDown = modalOpen();
}

function onPaste(event: ClipboardEvent): void {
  if (event.defaultPrevented || isTypingTarget(event.target) || modalOpen()) return;
  if (performance.now() - pasteKeyAt > 1000) return;
  pasteKeyAt = -Infinity;
  const command = getCommand("edit.paste");
  if (!command || !isEnabled(command) || !useEditorStore.getState().project) return;
  event.preventDefault();
  pasteText(event.clipboardData?.getData("text/plain"));
}

/** Installs the handler; returns an uninstall function. */
export function installGlobalShortcuts(): () => void {
  window.addEventListener("keydown", onKeyDownCapture, true);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("paste", onPaste);
  return () => {
    window.removeEventListener("keydown", onKeyDownCapture, true);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("paste", onPaste);
  };
}
