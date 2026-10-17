/** Small building blocks for tool options (tokens only), shared by built-in and later entries. */
import type { ReactNode } from "react";

import type { CommandId } from "../../shortcuts/shortcuts";
import { Icon } from "../primitives/Icon";
import { Segmented as PrimitiveSegmented } from "../primitives/Segmented";
import { Tooltip } from "../primitives/Tooltip";

/** Dropdown trigger in the options bar (24px, field). */
export const triggerClass =
  "flex h-control-sm min-w-0 items-center gap-1.5 rounded-sm border border-line bg-field pr-1.5 pl-1.5 text-sm text-text outline-none transition-colors hover:border-line-strong data-popup-open:border-line-strong focus-visible:border-accent";

export function OptionLabel({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-sm text-muted">{children}</span>;
}

/** A vertical divider between option groups. */
export function OptionDivider() {
  return <div aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line-subtle" />;
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
        <Icon name={icon} size={12} />
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
    <PrimitiveSegmented
      label={label}
      value={String(value)}
      onValueChange={(next) => {
        const option = options.find((o) => String(o.value) === next);
        if (option) onChange(option.value);
      }}
      className={dim ? "opacity-60" : ""}
      items={options.map((option) => ({
        value: String(option.value),
        label: <>{option.glyph}{option.text}</>,
        attrs: { "aria-label": option.label },
        ...(option.text ? {} : { tooltip: option.label }),
      }))}
    />
  );
}
