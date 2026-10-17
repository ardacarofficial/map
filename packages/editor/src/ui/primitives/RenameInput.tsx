/** Inline rename: initial value, accessible label, onDone(name/null); Enter/blur commit, Escape cancels. */
import { useRef, useState, type ComponentPropsWithRef } from "react";

type RenameInputProps = Omit<ComponentPropsWithRef<"input">, "value" | "defaultValue"> & {
  initial: string;
  label: string;
  onDone(name: string | null): void;
};
export function RenameInput({ initial, label, onDone, className = "", ref, onChange, onFocus, onBlur, onKeyDown, ...rest }: RenameInputProps) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      autoFocus
      spellCheck={false}
      autoComplete="off"
      maxLength={64}
      {...rest}
      ref={ref}
      value={value}
      aria-label={label}
      onChange={(event) => { onChange?.(event); if (!event.defaultPrevented) setValue(event.target.value); }}
      onFocus={(event) => { event.currentTarget.select(); onFocus?.(event); }}
      onBlur={(event) => { onBlur?.(event); if (!event.defaultPrevented) finish(value); }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === "Enter") { event.preventDefault(); finish(value); }
        else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(null); }
      }}
      className={`h-control-sm min-w-0 flex-1 rounded-sm border border-accent bg-field px-1.5 text-sm text-text focus-visible:outline-none ${className}`}
    />
  );
}
