import type { FocusEvent, MouseEvent } from "react";

/** Inputs focused by this press: their first mouseup must not drop the select-all. */
const pressed = new WeakSet<HTMLInputElement>();

/**
 * Spread on a name/number input so it opens with its text selected and typing
 * replaces it — also when the focus comes from a click (the click's mouseup
 * would otherwise place a caret and drop the selection).
 */
export const selectAll = {
  onMouseDown(e: MouseEvent<HTMLInputElement>): void {
    if (document.activeElement !== e.currentTarget) pressed.add(e.currentTarget);
  },
  onFocus(e: FocusEvent<HTMLInputElement>): void {
    e.currentTarget.select();
  },
  onMouseUp(e: MouseEvent<HTMLInputElement>): void {
    if (pressed.delete(e.currentTarget)) e.preventDefault();
  },
};
