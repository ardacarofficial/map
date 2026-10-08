/**
 * No browser context menu (Geri / Yenile / Yazdır / İncele) anywhere in the
 * editor: right-click either does something meaningful (pick a tile on the
 * map, an app menu from a Base UI `ContextMenu`) or nothing. Text fields keep
 * the native Kes / Kopyala / Yapıştır menu.
 *
 * Bubble phase on `window`: app menus (Base UI, React handlers) see the event
 * first and open; the guard only stops the browser's own menu afterwards.
 * The desktop shell filters WebView2's menu the same way in Rust.
 */

/** Right-clicking these keeps the native (edit) menu. */
const NATIVE_MENU_SELECTOR = 'input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/** Element-like target (duck-typed so the rule is testable without a DOM). */
interface ElementLike {
  closest(selector: string): (ElementLike & { tagName?: string; type?: string }) | null;
}

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/** True when the native context menu should open for `target`. */
export function allowsNativeContextMenu(target: EventTarget | null): boolean {
  const el = target as Partial<ElementLike> | null;
  if (!el || typeof el.closest !== "function") return false;
  const field = el.closest(NATIVE_MENU_SELECTOR);
  if (!field) return false;
  // Checkboxes, sliders and buttons are inputs too, but have no edit menu.
  if (field.tagName?.toUpperCase() === "INPUT") return !NON_TEXT_INPUTS.has((field.type ?? "text").toLowerCase());
  return true;
}

function onContextMenu(event: MouseEvent): void {
  if (allowsNativeContextMenu(event.target)) return;
  event.preventDefault();
}

/** Installs the guard; returns an uninstall function. */
export function installContextMenuGuard(): () => void {
  window.addEventListener("contextmenu", onContextMenu);
  return () => window.removeEventListener("contextmenu", onContextMenu);
}
