/** Controlled 28×16 switch: checked, onChange, label; all Base UI props/ref pass through. */
import { Switch } from "@base-ui/react/switch";
import type { ComponentPropsWithRef } from "react";

type ToggleProps = Omit<ComponentPropsWithRef<typeof Switch.Root>, "checked" | "onChange"> & {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
};
export function Toggle({ checked, onChange, label, className = "", ...rest }: ToggleProps) {
  return (
    <Switch.Root
      {...rest}
      checked={checked}
      onCheckedChange={(next, details) => { onChange(next); rest.onCheckedChange?.(next, details); }}
      aria-label={label}
      className={`relative flex h-4 w-7 shrink-0 items-center rounded-full border border-control-border bg-field p-0.5 transition-colors duration-(--duration-fast) data-checked:border-accent data-checked:bg-accent data-disabled:opacity-40 ${className}`}
    >
      <Switch.Thumb className="size-2.5 rounded-full bg-muted transition-transform duration-(--duration-fast) data-checked:translate-x-3 data-checked:bg-on-accent" />
    </Switch.Root>
  );
}
