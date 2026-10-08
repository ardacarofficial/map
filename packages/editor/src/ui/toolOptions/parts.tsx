/** Small building blocks for tool options (tokens only), shared by built-in and later entries. */
import type { ReactNode } from "react";

import type { CommandId } from "../../shortcuts/shortcuts";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";

/** Dropdown trigger in the options bar (h-7, raised). */
export const triggerClass =
  "flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-line bg-raised pr-1.5 pl-1.5 text-sm text-text outline-none transition-colors hover:border-line-strong data-popup-open:border-line-strong focus-visible:border-accent";

export function OptionLabel({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-sm text-faint">{children}</span>;
}

/** A vertical divider between option groups. */
export function OptionDivider() {
  return <div aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line" />;
}

export function StepButton({
  icon,
  label,
  command,
  disabled,
  onClick,
}: {
  icon: "plus" | "minus";
  label: string;
  command?: CommandId;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <Tooltip label={label} {...(command ? { command } : {})}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className="grid h-full w-6 place-items-center text-muted transition-colors hover:text-text disabled:opacity-30"
      >
        <Icon name={icon} size={12} strokeWidth={2.25} />
      </button>
    </Tooltip>
  );
}

export interface SegmentOption<V> {
  value: V;
  /** Accessible name (and tooltip when there is no text). */
  label: string;
  glyph?: ReactNode;
  /** Visible text next to the glyph. */
  text?: string;
}

/** A row of mutually exclusive buttons (radio group). */
export function Segmented<V extends string | number>({
  label,
  value,
  options,
  onChange,
  dim = false,
}: {
  label: string;
  value: V;
  options: readonly SegmentOption<V>[];
  onChange(value: V): void;
  /** Shown quieter (e.g. shape while the brush is 1 cell). */
  dim?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-line bg-raised p-0.5 ${dim ? "opacity-60" : ""}`}>
      {options.map((option) => {
        const on = option.value === value;
        const button = (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={option.label}
            onClick={() => onChange(option.value)}
            className={`flex h-full items-center gap-1.5 rounded-sm px-1.5 text-sm transition-colors duration-100 ${
              on ? "bg-active text-text shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-faint hover:text-muted"
            }`}
          >
            {option.glyph && <span className={`grid size-3.5 place-items-center ${on ? "text-accent" : ""}`}>{option.glyph}</span>}
            {option.text && <span className="whitespace-nowrap">{option.text}</span>}
          </button>
        );
        return option.text ? button : (
          <Tooltip key={String(option.value)} label={option.label}>
            {button}
          </Tooltip>
        );
      })}
    </div>
  );
}
