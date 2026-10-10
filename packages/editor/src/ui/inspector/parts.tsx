/** Building blocks of the Denetçi cards (tokens only). */
import { useState, type KeyboardEvent, type ReactNode } from "react";

import { getCommand, isEnabled, runCommand } from "../../commands/registry";
import type { CommandId } from "../../shortcuts/shortcuts";
import { Icon, type IconName } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";

/** "DÖNÜŞÜM", "FIRÇA": 11 px uppercase section header. */
export function SectionHeader({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-2 px-3 pt-2">
      <h3 className="min-w-0 flex-1 truncate text-xs font-semibold tracking-[0.06em] text-muted uppercase">{children}</h3>
      {extra}
    </div>
  );
}

/** Title row of a card: 16 px semibold name with an optional leading visual and subtitle. */
export function CardTitle({ leading, title, subtitle, extra }: { leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 pt-3 pb-1">
      {leading}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[16px] leading-[22px] font-semibold text-text" data-inspector-title>
          {title}
        </span>
        {subtitle && <span className="truncate text-sm text-muted">{subtitle}</span>}
      </div>
      {extra}
    </div>
  );
}

/** Label | control rows (label column 64 px). */
export function PropGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-2 gap-y-2 px-3 py-1.5 text-md">{children}</div>;
}

export function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="truncate text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
    </>
  );
}

/** A read-only value in the input look ("6 × 5 tile"). */
export function ReadField({ children, mono = true, className = "" }: { children: ReactNode; mono?: boolean; className?: string }) {
  return (
    <span className={`flex h-7 min-w-0 flex-1 items-center truncate rounded-md border border-line bg-raised px-2 text-md text-text ${mono ? "font-mono tabular" : ""} ${className}`}>
      {children}
    </span>
  );
}

/**
 * Integer input: commits on Enter / blur (clamped to [min, max]), Esc
 * reverts, ↑ / ↓ step by one. `prefix` is a faint label inside ("X").
 */
export function IntField({
  value,
  min,
  max,
  onCommit,
  label,
  prefix,
}: {
  value: number;
  min: number;
  max: number;
  onCommit(v: number): void;
  label: string;
  prefix?: string;
}) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }
  const parsed = /^\s*-?\d+\s*$/.test(text) ? Number.parseInt(text, 10) : null;
  const valid = parsed !== null && parsed >= min && parsed <= max;
  const commit = (v: number | null = parsed) => {
    if (v === null || v < min || v > max) {
      setText(String(value));
      return;
    }
    if (v !== value) onCommit(v);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setText(String(value));
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.min(max, Math.max(min, value + (event.key === "ArrowUp" ? 1 : -1)));
      setText(String(next));
      commit(next);
    }
  };
  return (
    <label
      className={`flex h-7 min-w-0 flex-1 items-center rounded-md border bg-raised transition-colors focus-within:border-accent ${
        valid ? "border-line hover:border-line-strong" : "border-danger"
      } ${prefix ? "pl-2" : ""}`}
    >
      {prefix && <span className="font-mono text-xs text-faint">{prefix}</span>}
      <input
        value={text}
        aria-label={label}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit()}
        spellCheck={false}
        autoComplete="off"
        className="h-full w-full min-w-0 bg-transparent px-2 font-mono text-md text-text tabular focus-visible:outline-none"
      />
    </label>
  );
}

/** Thin divider between cards. */
export function CardDivider() {
  return <div aria-hidden className="mx-3 my-2 h-px bg-line" />;
}

/**
 * A full-width action button of a card ("Kopyala"). Disabled actions stay
 * visible; the tooltip says why.
 */
export function ActionButton({
  icon,
  glyph,
  label,
  onClick,
  disabledReason = null,
  command,
  tone = "default",
  dataAction,
}: {
  icon?: IconName;
  glyph?: ReactNode;
  label: string;
  onClick(): void;
  disabledReason?: string | null;
  command?: CommandId;
  tone?: "default" | "primary" | "danger";
  dataAction?: string;
}) {
  const disabled = disabledReason !== null;
  const tones = {
    default: "border-line bg-raised text-text hover:border-line-strong hover:bg-hover",
    primary: "border-transparent bg-accent text-on-accent font-medium hover:bg-accent-hover",
    danger: "border-line bg-raised text-danger hover:border-danger/60 hover:bg-danger-soft",
  } as const;
  const button = (
    <button
      type="button"
      aria-disabled={disabled || undefined}
      data-action={dataAction ?? command}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={`flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-sm border px-2 text-md transition-colors duration-100 ${
        disabled ? "cursor-default border-line bg-raised text-faint opacity-50" : tones[tone]
      }`}
    >
      {icon ? <Icon name={icon} size={14} className="shrink-0" /> : glyph}
      <span className="truncate">{label}</span>
    </button>
  );
  return (
    <Tooltip label={disabled && disabledReason !== label ? disabledReason! : label} {...(command ? { command } : {})}>
      {button}
    </Tooltip>
  );
}

/** {@link ActionButton} that runs a registered command (disabled while the command is). */
export function CommandAction({ command, ...rest }: { command: CommandId; icon?: IconName; glyph?: ReactNode; label: string; tone?: "default" | "primary" | "danger"; disabledReason?: string }) {
  const cmd = getCommand(command);
  const enabled = !!cmd && isEnabled(cmd);
  return <ActionButton {...rest} command={command} disabledReason={enabled ? null : (rest.disabledReason ?? rest.label)} onClick={() => runCommand(command)} />;
}

/** Small square icon button with a tooltip (flip, rotate). */
export function SquareAction({
  label,
  command,
  onClick,
  children,
  disabled = false,
}: {
  label: string;
  command?: CommandId;
  onClick(): void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip label={label} {...(command ? { command } : {})}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        data-action={command}
        onClick={onClick}
        className="grid size-8 shrink-0 place-items-center rounded-sm border border-line bg-raised text-muted transition-colors hover:border-line-strong hover:bg-hover hover:text-text disabled:pointer-events-none disabled:opacity-35"
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** Flip / rotate glyphs (16 px line icons; not in the shared set). */
export function TransformGlyph({ kind }: { kind: "flipX" | "flipY" | "rotateCW" | "rotateCCW" }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (kind) {
    case "flipX":
      return (
        <svg {...common}>
          <path d="M12 3v18" strokeDasharray="2 2.5" />
          <path d="M9 7 4 17h5Z" />
          <path d="m15 7 5 10h-5Z" />
        </svg>
      );
    case "flipY":
      return (
        <svg {...common}>
          <path d="M3 12h18" strokeDasharray="2 2.5" />
          <path d="M7 9 17 4v5Z" />
          <path d="m7 15 10 5v-5Z" />
        </svg>
      );
    case "rotateCW":
      return (
        <svg {...common}>
          <path d="M20 11a8 8 0 1 0-2.3 5.7" />
          <path d="M20 4v7h-7" />
        </svg>
      );
    case "rotateCCW":
      return (
        <svg {...common}>
          <path d="M4 11a8 8 0 1 1 2.3 5.7" />
          <path d="M4 4v7h7" />
        </svg>
      );
  }
}
