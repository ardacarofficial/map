/** Shared roving navigation for tabs/radios; disabled items are skipped and arrows wrap. */
import type { ButtonHTMLAttributes } from "react";

export type ItemAttrs = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "role" | "tabIndex"> & {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

export function rovingIndex(key: string, current: number, disabled: readonly boolean[], rtl = false): number | undefined {
  const enabled = disabled.flatMap((off, index) => off ? [] : [index]);
  if (!enabled.length) return undefined;
  if (key === "Home") return enabled[0];
  if (key === "End") return enabled[enabled.length - 1];
  const delta = key === "ArrowRight" ? (rtl ? -1 : 1) : key === "ArrowLeft" ? (rtl ? 1 : -1) : key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
  if (!delta) return undefined;
  const position = enabled.indexOf(current);
  return enabled[(position + delta + enabled.length) % enabled.length];
}
