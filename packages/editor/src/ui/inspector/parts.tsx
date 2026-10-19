
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { getCommand, isEnabled, runCommand } from "../../commands/registry";
import { keysFor, type CommandId } from "../../shortcuts/shortcuts";
import { Button, IconButton } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { SectionHeader as PrimitiveSectionHeader } from "../primitives/SectionHeader";
import { Tooltip } from "../primitives/Tooltip";

export function SectionHeader({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return <PrimitiveSectionHeader title={children} actions={extra} padding={12} />;
}

export function CardTitle({ leading, title, subtitle, extra }: { leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-2 px-3 py-2">
      {leading && <span className="flex size-4 shrink-0 items-center justify-center overflow-hidden text-muted [&>*]:size-4 [&>*]:border-0 [&>*]:bg-transparent [&_svg]:size-4">{leading}</span>}
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="max-w-full shrink-0 truncate text-md font-semibold text-title" data-inspector-title>{title}</span>
        {subtitle && <span className="min-w-0 truncate text-sm text-faint">{subtitle}</span>}
      </div>
      {extra}
    </div>
  );
}

export function PropGrid({ children }: { children: ReactNode }) {
  return <div className="flex flex-col px-3 text-sm">{children}</div>;
}

export function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-control-md items-center gap-2">
      <span className="w-proplabel shrink-0 truncate text-sm text-muted" title={label}>{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

export function ReadField({ children, mono = typeof children === "number", className = "" }: { children: ReactNode; mono?: boolean; className?: string }) {
  return <span className={`flex min-w-0 flex-1 items-center truncate text-sm text-text tabular ${mono ? "font-mono" : ""} ${className}`}>{children}</span>;
}

/** Prefix scrubbing previews locally; callers may preview without creating undo steps. */
export function IntField({ value, min, max, onCommit, onPreview, label, prefix }: {
  value: number;
  min: number;
  max: number;
  onCommit(v: number): void;
  onPreview?(v: number): void;
  label: string;
  prefix?: ReactNode;
}) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  const drag = useRef<{ x: number; initial: number; next: number } | null>(null);
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }
  const parsed = /^\s*-?\d+\s*$/.test(text) ? Number(text) : null;
  const valid = parsed !== null && parsed >= min && parsed <= max;
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const commit = (next: number | null = parsed) => {
    if (next === null || !Number.isSafeInteger(next) || next < min || next > max) {
      setText(String(value));
      return;
    }
    setText(String(next));
    if (next !== value) onCommit(next);
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
      commit(clamp((parsed ?? value) + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1)));
    }
  };
  return (
    <label className={`flex h-control-sm min-w-0 flex-1 items-center rounded-sm border bg-field focus-within:border-accent ${valid ? "border-line hover:border-line-strong" : "border-danger"}`}>
      {prefix && (
        <span
          aria-label={label}
          title={label}
          className="flex h-full cursor-ew-resize touch-none items-center pl-2 font-mono text-xs text-muted select-none"
          onClick={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, initial: value, next: value };
          }}
          onPointerMove={(event) => {
            const d = drag.current;
            if (!d) return;
            const next = clamp(d.initial + Math.trunc((event.clientX - d.x) / 4) * (event.shiftKey ? 10 : 1));
            if (next === d.next) return;
            d.next = next;
            setText(String(next));
            onPreview?.(next);
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (d && d.next !== d.initial) onCommit(d.next);
          }}
          onPointerCancel={() => {
            const d = drag.current;
            drag.current = null;
            if (d) { setText(String(d.initial)); onPreview?.(d.initial); }
          }}
          onLostPointerCapture={() => {
            const d = drag.current;
            drag.current = null;
            if (d) { setText(String(d.initial)); onPreview?.(d.initial); }
          }}
        >{prefix}</span>
      )}
      <input value={text} aria-label={label} inputMode="numeric" onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} onBlur={() => commit()} spellCheck={false} autoComplete="off" className="h-full w-full min-w-0 bg-transparent px-2 font-mono text-sm text-text tabular focus-visible:outline-none" />
    </label>
  );
}

export function CardDivider() {
  return <div aria-hidden className="mx-3 my-3 h-px bg-line-subtle" />;
}

export function ActionButton({ icon, glyph, label, onClick, disabledReason = null, command, tone = "default", dataAction }: {
  icon?: IconName;
  glyph?: ReactNode;
  label: string;
  onClick(): void;
  disabledReason?: string | null;
  command?: CommandId;
  tone?: "default" | "primary" | "danger";
  dataAction?: string;
}) {
  return (
    <Tooltip disabled={!(disabledReason && disabledReason !== label) && !(command && keysFor(command)[0])} label={disabledReason ?? label} {...(command ? { command } : {})}>
      <Button size="sm" variant={tone === "danger" ? "ghost" : "secondary"} aria-disabled={disabledReason !== null || undefined} data-action={dataAction ?? command} onClick={() => { if (disabledReason === null) onClick(); }} className={`self-start justify-self-start ${tone === "danger" ? "text-danger! hover:text-danger!" : ""} ${disabledReason !== null ? "opacity-40" : ""}`}>
        {icon ? <Icon name={icon} size={16} /> : glyph}<span className="truncate">{label}</span>
      </Button>
    </Tooltip>
  );
}

export function CommandAction({ command, ...rest }: { command: CommandId; icon?: IconName; glyph?: ReactNode; label: string; tone?: "default" | "primary" | "danger"; disabledReason?: string }) {
  const cmd = getCommand(command);
  const enabled = !!cmd && isEnabled(cmd);
  return <ActionButton {...rest} command={command} disabledReason={enabled ? null : (rest.disabledReason ?? rest.label)} onClick={() => runCommand(command)} />;
}

export function SquareAction({ label, command, onClick, children, disabled = false, dataAction }: {
  label: string;
  command?: CommandId;
  onClick(): void;
  children: ReactNode;
  disabled?: boolean;
  dataAction?: string;
}) {
  return (
    <Tooltip label={label} {...(command ? { command } : {})}>
      <IconButton size="sm" aria-label={label} aria-disabled={disabled || undefined} className={disabled ? "opacity-40" : ""} data-action={dataAction ?? command} onClick={() => { if (!disabled) onClick(); }}>{children}</IconButton>
    </Tooltip>
  );
}
