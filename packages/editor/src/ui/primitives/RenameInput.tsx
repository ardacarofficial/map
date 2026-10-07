import { useRef, useState, type KeyboardEvent } from "react";

/** Inline rename field: Enter / blur commit, Esc cancels (`onDone(null)`). */
export function RenameInput({
  initial,
  label,
  onDone,
  className = "",
}: {
  initial: string;
  label: string;
  onDone(name: string | null): void;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    }
  };
  return (
    <input
      autoFocus
      value={value}
      aria-label={label}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(value)}
      onKeyDown={onKeyDown}
      spellCheck={false}
      autoComplete="off"
      maxLength={64}
      className={`h-6 min-w-0 flex-1 rounded-sm border border-accent bg-panel px-1.5 text-md text-text ring-2 ring-accent-soft focus-visible:outline-none ${className}`}
    />
  );
}
