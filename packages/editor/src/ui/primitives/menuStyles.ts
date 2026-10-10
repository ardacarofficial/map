/** Shared classes for Base UI menus (tokens only). */
export const menuPositionerClass = "z-50 outline-none";

export const menuPopupClass =
  "min-w-[200px] origin-(--transform-origin) rounded-lg border border-line bg-popup p-1 text-text shadow-popup outline-none transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";

export const menuItemClass =
  "flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-md text-text outline-none select-none data-highlighted:bg-hover data-disabled:opacity-40";

export const menuSeparatorClass = "mx-1 my-1 h-px bg-line-subtle";
