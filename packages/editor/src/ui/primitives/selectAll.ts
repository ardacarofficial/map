import type { FocusEvent, MouseEvent } from "react";

/** Inputs whose text was selected on focus and not clicked into since. */
const fresh = new WeakSet<HTMLInputElement>();
/** Inputs being focused by the current press. */
const pressing = new WeakSet<HTMLInputElement>();

/**
 * Spread on a name/number input so it opens with its text selected and typing
 * replaces it. The first click after the focus (the click that focused it, or a
 * click into an auto-focused field) keeps the selection instead of placing a
 * caret, like a browser address bar; later clicks behave normally.
 */
export const selectAll = {
  onFocus(e: FocusEvent<HTMLInputElement>): void {
    e.currentTarget.select();
    fresh.add(e.currentTarget);
  },
  onMouseDown(e: MouseEvent<HTMLInputElement>): void {
    const el = e.currentTarget;
    if (document.activeElement !== el) { pressing.add(el); return; }
    if (fresh.delete(el)) e.preventDefault();
  },
  onMouseUp(e: MouseEvent<HTMLInputElement>): void {
    const el = e.currentTarget;
    if (pressing.delete(el)) { fresh.delete(el); e.preventDefault(); }
  },
};
