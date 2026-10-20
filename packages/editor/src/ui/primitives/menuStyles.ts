/** Shared Base UI menu classes: 24px items, unboxed shortcuts and level-one elevation. */
export const menuPositionerClass = "overlay-positioner outline-none";
export const menuPopupClass =
  "overlay-popup min-w-48 rounded-md border border-line-strong bg-popup p-1 text-text shadow-popup outline-none transition-[opacity,translate] duration-(--duration-ui) ease-out data-ending-style:pointer-events-none data-ending-style:translate-y-0.5 data-ending-style:opacity-0 data-starting-style:translate-y-0.5 data-starting-style:opacity-0";
export const menuItemClass =
  "flex min-h-row shrink-0 cursor-default items-center gap-2 rounded-sm px-2 text-sm outline-none select-none [&>span]:min-w-0 data-highlighted:bg-hover-popup data-disabled:pointer-events-none data-disabled:opacity-40";
export const menuSeparatorClass = "my-1 h-px bg-line-subtle";
export const menuShortcutClass = "ml-auto font-mono text-xs text-muted";
export const menuDangerItemClass = "text-danger";
export const menuGroupLabelClass = "flex min-h-row shrink-0 items-center px-2 py-1 text-xs text-muted uppercase";
