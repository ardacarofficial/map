import type { TerrainTemplate, Tileset } from "@smap/core";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { defineAndActivateTerrain, uniqueTerrainName } from "../../commands/terrainActions";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { useUiStore } from "../uiStore";
import { TemplatePicker } from "./TemplatePicker";

/** Top-left tile of the block the user placed in the tileset (cells). */
export interface TerrainOrigin {
  col: number;
  row: number;
}

/**
 * "Arazi tanımla" strip for the tileset panel: template picker + "Bitti",
 * then (once a block is placed) the name form, or why the block does not fit,
 * or the hint. Submitting defines AND activates the terrain — the user can
 * paint right away (no extra "Çiz" step).
 *
 * The tileset panel owns the block placement (`pending`, `problem`) and the
 * mode; `onDone` leaves the mode, `onCancel` un-places the block.
 */
export function TerrainDefineBar({
  tileset,
  template,
  pending,
  problem,
  onCancel,
  onDone,
}: {
  tileset: Tileset;
  template: TerrainTemplate;
  pending: TerrainOrigin | null;
  problem: string | null;
  onCancel(): void;
  onDone(): void;
}) {
  const setTemplate = useUiStore((s) => s.setTerrainTemplate);
  return (
    <div data-terrain-define="" className="mx-2 mb-1 flex shrink-0 flex-col gap-1.5 rounded-md border border-line bg-raised p-1.5">
      <div className="flex items-center gap-1.5">
        <TemplatePicker value={template} onChange={setTemplate} />
        <Button variant="ghost" className="h-7 shrink-0 px-2 text-sm" onClick={onDone}>
          {t("tileset.done")}
        </Button>
      </div>
      {pending ? (
        <TerrainNameForm
          key={`${pending.col},${pending.row}`}
          tileset={tileset}
          template={template}
          origin={pending}
          onCancel={onCancel}
          onDefined={onDone}
        />
      ) : problem ? (
        <div role="alert" className="flex items-start gap-1.5 px-0.5 text-xs leading-4 text-danger">
          <Icon name="alert" size={13} className="mt-px shrink-0" />
          {problem}
        </div>
      ) : (
        <div className="px-0.5 text-xs leading-4 text-muted">{t("tileset.terrainModeHint")}</div>
      )}
    </div>
  );
}

/**
 * Name of the new terrain. Focused (and selected) as soon as it appears —
 * after the click that placed the block, so the tileset does not keep focus.
 * Enter defines + activates (see `defineAndActivateTerrain`), Esc cancels.
 */
export function TerrainNameForm({
  tileset,
  template,
  origin,
  onCancel,
  onDefined,
}: {
  tileset: Tileset;
  template: TerrainTemplate;
  origin: TerrainOrigin;
  onCancel(): void;
  /** Runs after the terrain was defined and activated. */
  onDefined(): void;
}) {
  const store = useEditorStore((s) => s.project?.store);
  const [name, setName] = useState(() => (store ? uniqueTerrainName(store.document) : ""));
  const inputRef = useRef<HTMLInputElement>(null);

  // The placing click focuses the tileset after this mounts; take focus back once it settled.
  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    };
    focus();
    const frame = requestAnimationFrame(focus);
    const timer = window.setTimeout(focus, 60);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  const submit = () => {
    if (!defineAndActivateTerrain(tileset.id, template, origin, name)) return;
    onDefined();
  };
  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        submit();
      }}
      className="flex items-center gap-1.5"
    >
      <input
        ref={inputRef}
        value={name}
        aria-label={t("terrain.name")}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        spellCheck={false}
        autoComplete="off"
        maxLength={64}
        className="h-7 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 text-md text-text focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      />
      <Button type="submit" variant="primary" className="h-7 px-2.5 text-sm">
        {t("terrain.define")}
      </Button>
      <Button variant="ghost" className="h-7 px-2 text-sm" onClick={onCancel}>
        {t("common.cancel")}
      </Button>
    </form>
  );
}
