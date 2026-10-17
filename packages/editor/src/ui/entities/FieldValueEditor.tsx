import type { EntityFieldDef, EntityFieldValue } from "@smap/core";
import { useEffect, useId, useState, type KeyboardEvent } from "react";

import { t } from "../../i18n";
import { inputBad, inputOk, NativeSelect } from "../primitives/NativeSelect";
import { TextField } from "../primitives/TextField";
import { Toggle } from "../primitives/Toggle";
import { rawFromValue, valueFromRaw, type RawValue } from "./fieldValues";

export interface LevelOption {
  id: string;
  name: string;
}

/**
 * Typed input for one entity field value. Text and numbers commit on Enter /
 * blur (Esc reverts), choices and switches commit at once, so each commit is
 * one undo step. With `live`, every valid keystroke commits (type defaults in
 * the types dialog, which are saved together later).
 */
export function FieldValueEditor({
  field,
  value,
  onCommit,
  levels,
  label,
  live = false,
  size = "sm",
  onValidity,
}: {
  field: Pick<EntityFieldDef, "type" | "enumValues">;
  value: EntityFieldValue;
  onCommit(value: EntityFieldValue): void;
  levels: readonly LevelOption[];
  label: string;
  live?: boolean;
  size?: "sm" | "md";
  /** Told whether what is typed right now is valid (so a form can block saving). */
  onValidity?(valid: boolean): void;
}) {
  const id = useId();
  const valueKey = JSON.stringify(value) + field.type;
  const [raw, setRaw] = useState<RawValue>(() => rawFromValue(field.type, value));
  const [shownKey, setShownKey] = useState(valueKey);
  // A new value from outside (undo, another entity) replaces what is typed.
  if (shownKey !== valueKey) {
    setShownKey(valueKey);
    setRaw(rawFromValue(field.type, value));
  }
  const parsed = valueFromRaw(field, raw);
  const error = parsed.ok ? null : t(parsed.error);
  useEffect(() => {
    onValidity?.(parsed.ok);
  }, [parsed.ok, onValidity]);
  useEffect(() => () => onValidity?.(true), [onValidity]);

  const commit = (next: RawValue = raw) => {
    const result = valueFromRaw(field, next);
    if (!result.ok) return;
    if (JSON.stringify(result.value) !== JSON.stringify(value)) onCommit(result.value);
  };
  const change = (patch: Partial<RawValue>, immediate = false) => {
    const next = { ...raw, ...patch };
    setRaw(next);
    if (immediate || live) commit(next);
  };
  const revert = () => setRaw(rawFromValue(field.type, value));
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      revert();
    }
  };
  // Leaving the field with an invalid entry goes back to the stored value.
  const onBlur = () => {
    if (parsed.ok) commit();
    else revert();
  };

  const errorNode = error && (
    <span id={`${id}-err`} className="text-xs text-danger">
      {error}
    </span>
  );

  switch (field.type) {
    case "bool":
      return (
        <span className="flex h-control-sm items-center gap-2">
          <Toggle checked={raw.bool} onChange={(bool) => change({ bool }, true)} label={label} />
          <span className={raw.bool ? "text-text" : "text-muted"}>{raw.bool ? t("entities.yes") : t("entities.no")}</span>
        </span>
      );
    case "enum":
      return (
        <span className="flex min-w-0 flex-col gap-0.5">
          <NativeSelect size={size}
            aria-label={label}
            value={raw.choice ?? ""}
            invalid={!!error}
            onChange={(e) => change({ choice: e.target.value }, true)}
          >
            {raw.choice === null || !(field.enumValues ?? []).includes(raw.choice) ? <option value="">—</option> : null}
            {(field.enumValues ?? []).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </NativeSelect>
          {errorNode}
        </span>
      );
    case "levelRef": {
      const missing = raw.choice !== null && !levels.some((l) => l.id === raw.choice);
      return (
        <NativeSelect size={size}
          aria-label={label}
          value={raw.choice ?? ""}
          invalid={missing}
          onChange={(e) => change({ choice: e.target.value === "" ? null : e.target.value }, true)}
        >
          <option value="">{t("entities.unset")}</option>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          {missing && <option value={raw.choice!}>{`${t("entities.portalMissing")} (${raw.choice})`}</option>}
        </NativeSelect>
      );
    }
    case "point":
      return (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            className="flex min-w-0 items-center gap-1.5"
            // x and y are one value: commit (or revert) only when focus leaves both.
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur();
            }}
          >
            {(["x", "y"] as const).map((axis) => (
              <label key={axis} className={`flex ${size === "sm" ? "h-control-sm" : "h-control-md"} min-w-0 flex-1 items-center rounded-sm border bg-field pl-2 transition-colors focus-within:border-accent ${error ? inputBad : inputOk}`}>
                <span className="font-mono text-2xs text-faint">{axis}</span>
                <input
                  value={raw[axis]}
                  aria-label={`${label} ${axis}`}
                  inputMode="numeric"
                  placeholder={t("entities.pointUnset")}
                  onChange={(e) => change({ [axis]: e.target.value })}
                  onKeyDown={onKeyDown}
                  spellCheck={false}
                  autoComplete="off"
                  className="h-full w-full min-w-0 bg-transparent px-1.5 font-mono text-md text-text tabular placeholder:font-sans placeholder:text-faint focus-visible:outline-none"
                />
              </label>
            ))}
            <span className="shrink-0 text-2xs text-faint">px</span>
          </span>
          {errorNode}
        </span>
      );
    default: {
      const numeric = field.type === "int" || field.type === "float";
      return (
        <span className="flex min-w-0 flex-col gap-0.5">
          <TextField size={size}
            value={raw.text}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err` : undefined}
            inputMode={field.type === "int" ? "numeric" : field.type === "float" ? "decimal" : "text"}
            onChange={(e) => change({ text: e.target.value })}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
            spellCheck={false}
            autoComplete="off"
            className={`${numeric ? "tabular" : ""} ${error ? "[&>input]:border-danger" : ""}`}
          />
          {errorNode}
        </span>
      );
    }
  }
}
