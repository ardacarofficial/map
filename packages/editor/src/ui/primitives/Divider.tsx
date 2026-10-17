/** Decorative 1px divider: orientation, tone (subtle/line), optional vertical length (16px). */
import type { ComponentPropsWithRef } from "react";

type DividerProps = ComponentPropsWithRef<"div"> & {
  orientation?: "horizontal" | "vertical";
  tone?: "subtle" | "line";
  length?: 16;
};
export function Divider({ orientation = "horizontal", tone = "subtle", length, className = "", ref, ...rest }: DividerProps) {
  return <div ref={ref} aria-hidden="true" {...rest} className={`shrink-0 ${tone === "line" ? "bg-line" : "bg-line-subtle"} ${orientation === "horizontal" ? "h-px w-full" : `w-px ${length === 16 ? "h-4" : "self-stretch"}`} ${className}`} />;
}
