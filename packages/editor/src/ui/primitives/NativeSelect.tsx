/** Native select with sm (24px) / md (28px) sizing; ref targets the select. */
import type { ComponentPropsWithRef } from "react";

import { Icon } from "./Icon";

export type NativeSelectProps = Omit<ComponentPropsWithRef<"select">, "size"> & {
  size?: "sm" | "md" | number;
  invalid?: boolean;
};
export function NativeSelect({ className = "", invalid = false, size = "md", children, ref, ...rest }: NativeSelectProps) {
  return (
    <span className={`relative flex min-w-0 items-center ${className}`}>
      <select
        ref={ref}
        {...rest}
        {...(typeof size === "number" ? { size } : {})}
        aria-invalid={invalid || rest["aria-invalid"]}
        className={`w-full min-w-0 appearance-none truncate rounded-sm border bg-field pr-6 pl-2 text-text transition-colors duration-(--duration-fast) disabled:opacity-40 focus-visible:border-accent focus-visible:outline-none ${size === "sm" ? "h-control-sm text-sm" : "h-control-md text-md"} ${invalid ? inputBad : inputOk}`}
      >
        {children}
      </select>
      <Icon name="chevron-down" size={12} className="pointer-events-none absolute right-1.5 text-muted" />
    </span>
  );
}

/** Shared field styles retained for existing input callers. */
export const inputClass =
  "h-control-md w-full min-w-0 rounded-sm border bg-field px-2 text-md text-text placeholder:text-faint transition-colors duration-(--duration-fast) focus-visible:border-accent focus-visible:outline-none disabled:opacity-40";
export const inputOk = "border-line hover:border-line-strong";
export const inputBad = "border-danger";
