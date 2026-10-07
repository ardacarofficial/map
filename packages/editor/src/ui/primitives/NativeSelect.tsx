import type { SelectHTMLAttributes } from "react";

import { Icon } from "./Icon";

/** A native `<select>` in the app's input style (keyboard and screen readers work as usual). */
export function NativeSelect({ className = "", invalid = false, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <span className={`relative flex min-w-0 items-center ${className}`}>
      <select
        {...rest}
        aria-invalid={invalid || undefined}
        className={`h-7 w-full min-w-0 appearance-none truncate rounded-md border bg-panel pr-6 pl-2 text-md text-text transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:outline-none ${
          invalid ? "border-danger" : "border-line hover:border-line-strong"
        }`}
      >
        {children}
      </select>
      <Icon name="chevronDown" size={13} className="pointer-events-none absolute right-1.5 text-faint" />
    </span>
  );
}

/** Text / number input in the same style as `NativeSelect`. */
export const inputClass =
  "h-7 w-full min-w-0 rounded-md border bg-panel px-2 text-md text-text transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:outline-none";
export const inputOk = "border-line hover:border-line-strong";
export const inputBad = "border-danger";
