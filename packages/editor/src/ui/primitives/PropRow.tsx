/** Property rows: 72px label; PropValue facts; PropField previews onChange and commits on blur/Enter/drag end. */
import { createContext, useContext, useEffect, useEffectEvent, useId, useRef, useState, type ComponentPropsWithRef, type ReactNode, type RefObject } from "react";

import { TextField } from "./TextField";

const RowContext = createContext<{ controlId: string; labelRef: RefObject<HTMLLabelElement | null> } | null>(null);

export type PropRowProps = ComponentPropsWithRef<"div"> & { label: ReactNode };
export function PropRow({ label, children, className = "", ref, ...rest }: PropRowProps) {
  const controlId = useId();
  const labelRef = useRef<HTMLLabelElement>(null);
  return (
    <RowContext.Provider value={{ controlId, labelRef }}>
      <div ref={ref} {...rest} className={`flex h-control-md items-center gap-2 ${className}`}>
        <label ref={labelRef} id={`${controlId}-label`} htmlFor={controlId} className="w-proplabel shrink-0 truncate text-sm text-muted">{label}</label>
        <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      </div>
    </RowContext.Provider>
  );
}

export type PropValueProps = ComponentPropsWithRef<"span"> & { align?: "left" | "right"; unit?: ReactNode };
export function PropValue({ align = "right", unit, children, className = "", ref, ...rest }: PropValueProps) {
  return <span ref={ref} {...rest} className={`tabular min-w-0 flex-1 truncate text-sm text-text ${align === "right" ? "text-right" : "text-left"} ${className}`}>{children}{unit && <span className="ml-1 text-faint">{unit}</span>}</span>;
}

export type PropFieldProps<T extends string | number> = Omit<ComponentPropsWithRef<"input">, "size" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step"> & {
  value: T;
  onChange?(value: T): void;
  onCommit?(value: T): void;
  min?: number;
  max?: number;
  step?: number;
  unit?: ReactNode;
  /** Numeric fields inside PropRow can scrub by dragging their label. */
  scrub?: boolean;
};

/** Accept dot/comma decimals; incomplete text is kept in the field until commit. */
export function parsePropNumber(text: string): number | undefined {
  const normalized = text.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function PropField<T extends string | number>({ value, onChange, onCommit, min, max, step = 1, unit, scrub = false, className = "", ref, type, id, disabled, readOnly, onFocus, onBlur, onKeyDown, ...rest }: PropFieldProps<T>) {
  const row = useContext(RowContext);
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const session = useRef<{ baseline: T; pending: boolean }>({ baseline: value, pending: false });
  const drag = useRef<{ pointerId: number; x: number; baseline: T; number: number; latest: T } | null>(null);
  const numeric = typeof value === "number" || type === "number";
  const clamp = (number: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Number(number.toFixed(10))));
  const fromNumber = (number: number) => (typeof value === "number" ? number : String(number)) as T;
  const fromText = (text: string): T | undefined => {
    if (!numeric) return text as T;
    const number = parsePropNumber(text);
    return number === undefined ? undefined : fromNumber(clamp(number));
  };
  const preview = (next: T) => { setDraft(String(next)); onChange?.(next); };
  const commit = () => {
    if (!session.current.pending) return;
    const next = fromText(draft) ?? session.current.baseline;
    session.current.pending = false;
    setEditing(false);
    setDraft(String(next));
    onChange?.(next);
    onCommit?.(next);
  };
  const revert = () => {
    const baseline = session.current.baseline;
    session.current.pending = false;
    setEditing(false);
    setDraft(String(baseline));
    onChange?.(baseline);
  };

  // Effect events read the latest value/callbacks without interrupting pointer capture on rerender.
  const startScrub = useEffectEvent((event: PointerEvent) => {
    if (event.button !== 0 || drag.current) return;
    const number = parsePropNumber(String(value));
    if (number === undefined) return;
    event.preventDefault();
    const label = event.currentTarget as HTMLLabelElement;
    label.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, baseline: value, number, latest: value };
    session.current = { baseline: value, pending: false };
    setDraft(String(value));
    setEditing(true);
  });
  const moveScrub = useEffectEvent((event: PointerEvent) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    const units = Math.trunc((event.clientX - active.x) / 4);
    if (!units) return;
    active.x += units * 4;
    active.number = clamp(active.number + units * (event.shiftKey ? 10 : 1));
    const next = fromNumber(active.number);
    if (next === active.latest) return;
    active.latest = next;
    preview(next);
  });
  const endScrub = useEffectEvent((event: PointerEvent) => {
    moveScrub(event);
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    drag.current = null;
    const label = event.currentTarget as HTMLLabelElement;
    if (label.hasPointerCapture(event.pointerId)) label.releasePointerCapture(event.pointerId);
    setEditing(false);
    onCommit?.(active.latest);
  });
  const cancelScrub = useEffectEvent((event: PointerEvent | KeyboardEvent) => {
    const active = drag.current;
    if (!active || ("key" in event ? event.key !== "Escape" : event.pointerId !== active.pointerId)) return;
    if ("key" in event) { event.preventDefault(); event.stopPropagation(); }
    drag.current = null;
    const label = row?.labelRef.current;
    if (label?.hasPointerCapture(active.pointerId)) label.releasePointerCapture(active.pointerId);
    setEditing(false);
    preview(active.baseline);
  });
  const labelRef = row?.labelRef;
  useEffect(() => {
    const label = labelRef?.current;
    if (!scrub || !numeric || disabled || readOnly || !label) return;
    label.classList.add("cursor-ew-resize", "touch-none");
    label.dataset.scrub = "";
    label.addEventListener("pointerdown", startScrub);
    label.addEventListener("pointermove", moveScrub);
    label.addEventListener("pointerup", endScrub);
    label.addEventListener("pointercancel", cancelScrub);
    label.addEventListener("lostpointercapture", cancelScrub);
    document.addEventListener("keydown", cancelScrub, true);
    return () => {
      label.classList.remove("cursor-ew-resize", "touch-none");
      delete label.dataset.scrub;
      label.removeEventListener("pointerdown", startScrub);
      label.removeEventListener("pointermove", moveScrub);
      label.removeEventListener("pointerup", endScrub);
      label.removeEventListener("pointercancel", cancelScrub);
      label.removeEventListener("lostpointercapture", cancelScrub);
      document.removeEventListener("keydown", cancelScrub, true);
      const active = drag.current;
      drag.current = null;
      if (active && label.hasPointerCapture(active.pointerId)) label.releasePointerCapture(active.pointerId);
    };
  }, [scrub, numeric, disabled, readOnly, labelRef]);

  return (
    <TextField
      {...rest}
      ref={ref}
      id={id ?? row?.controlId}
      aria-labelledby={rest["aria-labelledby"] ?? (row && !rest["aria-label"] ? `${row.controlId}-label` : undefined)}
      type={numeric ? "text" : type}
      inputMode={numeric ? "decimal" : rest.inputMode}
      role={numeric ? "spinbutton" : rest.role}
      aria-valuemin={numeric ? min : undefined}
      aria-valuemax={numeric ? max : undefined}
      aria-valuenow={numeric ? parsePropNumber(editing ? draft : String(value)) : undefined}
      disabled={disabled}
      readOnly={readOnly}
      size="sm"
      value={editing ? draft : String(value)}
      trailing={unit}
      className={`tabular w-full ${className}`}
      onChange={event => {
        if (!session.current.pending) session.current = { baseline: value, pending: true };
        setEditing(true);
        setDraft(event.target.value);
        const next = fromText(event.target.value);
        if (next !== undefined) onChange?.(next);
      }}
      onFocus={event => {
        session.current = { baseline: value, pending: true };
        setDraft(String(value));
        setEditing(true);
        onFocus?.(event);
      }}
      onBlur={event => { onBlur?.(event); if (!event.defaultPrevented) commit(); }}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (event.defaultPrevented || disabled || readOnly) return;
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); revert(); }
        else if (numeric && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          if (!session.current.pending) session.current = { baseline: value, pending: true };
          const number = parsePropNumber(editing ? draft : String(value)) ?? parsePropNumber(String(value)) ?? 0;
          setEditing(true);
          preview(fromNumber(clamp(number + (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1))));
        }
      }}
    />
  );
}
