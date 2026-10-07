import { Switch } from "@base-ui/react/switch";

/** Small on/off switch (Base UI), accent when on. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(checked: boolean): void; label: string }) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className="relative flex h-4 w-7 shrink-0 items-center rounded-full bg-line-strong p-0.5 transition-colors duration-100 data-checked:bg-accent"
    >
      <Switch.Thumb className="size-3 rounded-full bg-text shadow-popup transition-transform duration-100 data-checked:translate-x-3" />
    </Switch.Root>
  );
}
