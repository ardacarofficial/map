/**
 * Denetçi ARAZİ card (concept 11, "TERRAIN"): three faces.
 *
 * - Define (a rough rectangle was dragged in ⚙ Düzenle → Arazi): the found
 *   template ("Şablon ▾" with the other candidates), the set to add to,
 *   name, colour, background and the 3×3 preview → "Tanımla" (one undo step).
 * - Fix ("Düzelt"): what clicks in the tileset do, and "Bitti".
 * - Terrain brush: set ▾, the set's terrains with colours, Autotile, the 3×3
 *   auto-connect preview, background, "Düzelt" / remove.
 */
import { TERRAIN_COLORS, type TerrainSet, type Tileset } from "@smap/core";
import { useState } from "react";

import {
  chooseTerrain,
  defineTerrain,
  removeTerrainSet,
  renameTerrainSet,
  setAutotile,
  setTerrainBackground,
  setTerrainColor,
} from "../../commands/terrainActions";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { ActionButton, CardDivider, PropGrid, PropRow, SectionHeader } from "../inspector/parts";
import type { InspectorContext } from "../inspector/registry";
import { RenameInput } from "../primitives/RenameInput";
import { TileSwatch } from "../primitives/TileSwatch";
import { useUiStore } from "../uiStore";
import { clearTerrainDraft, startFix, useTerrainDraft, type TerrainDraft } from "./terrainDraft";
import { TerrainDot } from "./TerrainList";
import { MenuSelect, TerrainPickerMenu, selectTriggerClass, type SelectOption } from "./TerrainMenus";
import { draftResult, kindOfTemplate, previewTiles, resolveTerrain, templateLabel, type TerrainRef } from "./terrainModel";

const CELL = 40;

/** 3×3 tiles of `terrainId` around a full centre (what painting a blob looks like). */
export function TerrainPreview({ tileset, set, terrainId, cell = CELL }: { tileset: Tileset; set: TerrainSet; terrainId: number; cell?: number }) {
  const tiles = previewTiles(set, terrainId);
  const color = set.terrains.find((x) => x.id === terrainId)?.color ?? "#888888";
  return (
    <div
      className="grid w-max gap-px rounded-md border border-line bg-line p-px"
      style={{ gridTemplateColumns: `repeat(3, ${cell}px)` }}
      data-terrain-preview=""
      data-terrain-preview-missing={tiles.filter((x) => x === null).length}
    >
      {tiles.map((tile, i) =>
        tile === null ? (
          <span key={i} className="checker opacity-60" style={{ width: cell, height: cell, boxShadow: `inset 0 0 0 1px ${color}55` }} />
        ) : (
          <TileSwatch key={i} tileset={tileset} tileId={tile} size={cell} />
        ),
      )}
    </div>
  );
}

/** Colour choice: the standard terrain colours plus a free picker. */
function ColorRow({ value, onChange }: { value: string; onChange(color: string): void }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1" data-terrain-colors="">
      {TERRAIN_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          aria-pressed={c === value.toLowerCase()}
          onClick={() => onChange(c)}
          className={`size-5 rounded-full border transition-transform hover:scale-110 ${c === value.toLowerCase() ? "border-text" : "border-transparent"}`}
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        aria-label={t("terrain.color")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="size-5 cursor-pointer rounded-full border border-line bg-transparent p-0"
      />
    </div>
  );
}

function backgroundOptions(set: TerrainSet | undefined, exclude?: number): SelectOption<number>[] {
  return [
    { value: 0, label: t("terrain.backgroundNone") },
    ...(set?.terrains ?? []).filter((x) => x.id !== exclude).map((x) => ({ value: x.id, label: x.name, leading: <TerrainDot color={x.color} /> })),
  ];
}

// ------------------------------------------------------------------ define

function DefineFace({ ctx, draft }: { ctx: InspectorContext; draft: TerrainDraft }) {
  const patch = useTerrainDraft((s) => s.patchDraft);
  const tileset = ctx.doc.getTileset(draft.tilesetId);
  const candidate = draft.candidates[draft.index] ?? draft.candidates[0];
  if (!tileset || !candidate) return null;
  const kind = kindOfTemplate(candidate.template);
  const sets = (tileset.terrainSets ?? []).filter((s) => s.kind === kind);
  const setId = draft.setId && sets.some((s) => s.id === draft.setId) ? draft.setId : null;
  const targetSet = setId ? sets.find((s) => s.id === setId) : undefined;
  const input = { template: candidate.template, origin: candidate.origin, setId, name: draft.name || "…", color: draft.color, background: draft.background };
  const result = draftResult(tileset, input);
  const submit = () => {
    if (defineTerrain({ tilesetId: tileset.id, template: candidate.template, origin: candidate.origin, setId, name: draft.name, color: draft.color, background: draft.background })) {
      useUiStore.getState().setTilesetMode("pick");
      clearTerrainDraft();
    }
  };
  return (
    <div data-inspector-terrain="define">
      <SectionHeader>{t("terrain.defineTitle")}</SectionHeader>
      <div className="flex justify-center px-3 py-2">
        {result ? <TerrainPreview tileset={tileset} set={result.set} terrainId={result.terrainId} /> : <span className="text-sm text-danger">{t("terrain.noFit")}</span>}
      </div>
      <PropGrid>
        <PropRow label={t("terrain.template")}>
          <MenuSelect
            label={t("terrain.template")}
            dataAttr="data-terrain-template"
            value={candidate.template}
            options={draft.candidates.map((c) => ({ value: c.template, label: templateLabel(c.template), detail: `${Math.round(c.score * 100)}%` }))}
            onChange={(template) => {
              const i = draft.candidates.findIndex((c) => c.template === template);
              if (i >= 0) patch({ index: i, background: kindOfTemplate(template) === kind ? draft.background : 0 });
            }}
          />
        </PropRow>
        <PropRow label={t("terrain.set")}>
          <MenuSelect
            label={t("terrain.set")}
            dataAttr="data-terrain-target-set"
            value={setId ?? ""}
            options={[{ value: "", label: t("terrain.newSet") }, ...sets.map((s) => ({ value: s.id, label: s.name }))]}
            onChange={(v) => patch({ setId: v === "" ? null : v, background: 0 })}
          />
        </PropRow>
        <PropRow label={t("terrain.name")}>
          <input
            value={draft.name}
            aria-label={t("terrain.name")}
            data-terrain-name-input=""
            onChange={(e) => patch({ name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            spellCheck={false}
            autoComplete="off"
            maxLength={64}
            className="h-7 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-md text-text focus-visible:border-accent focus-visible:outline-none"
          />
        </PropRow>
        <PropRow label={t("terrain.color")}>
          <ColorRow value={draft.color} onChange={(color) => patch({ color })} />
        </PropRow>
        {kind === "corner" && targetSet && (
          <PropRow label={t("terrain.background")}>
            <MenuSelect label={t("terrain.background")} dataAttr="data-terrain-background" value={draft.background} options={backgroundOptions(targetSet)} onChange={(background) => patch({ background })} />
          </PropRow>
        )}
      </PropGrid>
      <p className="px-3 pb-1 text-xs leading-4 text-pretty text-faint">{t(kind === "corner" ? "terrain.defineHintCorner" : "terrain.defineHintBlob")}</p>
      <div className="flex gap-2 px-3 pt-1">
        <ActionButton label={t("terrain.define")} tone="primary" dataAction="terrain-define" disabledReason={result ? null : t("terrain.noFit")} onClick={submit} />
        <ActionButton label={t("common.cancel")} dataAction="terrain-define-cancel" onClick={clearTerrainDraft} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ fix

function FixFace({ ctx, fix }: { ctx: InspectorContext; fix: TerrainRef }) {
  const found = resolveTerrain(ctx.doc, fix);
  if (!found) return null;
  return (
    <div data-inspector-terrain="fix">
      <SectionHeader extra={<TerrainDot color={found.terrain.color} />}>{t("terrain.fixTitle", { name: found.terrain.name })}</SectionHeader>
      <div className="flex justify-center px-3 py-2">
        <TerrainPreview tileset={found.tileset} set={found.set} terrainId={fix.terrainId} />
      </div>
      <p className="px-3 pb-2 text-xs leading-4 text-pretty text-muted">{t(found.set.kind === "corner" ? "terrain.fixHintCorner" : "terrain.fixHintBlob")}</p>
      <div className="px-3">
        <ActionButton
          label={t("tileset.done")}
          tone="primary"
          dataAction="terrain-fix-done"
          onClick={() => {
            useUiStore.getState().setTilesetMode("pick");
            clearTerrainDraft();
          }}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ brush

function BrushFace({ ctx }: { ctx: InspectorContext }) {
  const choice = useEditorStore((s) => s.terrain);
  const active = useEditorStore((s) => s.terrainActive);
  const [renaming, setRenaming] = useState(false);
  const found = resolveTerrain(ctx.doc, choice);
  if (!found || !choice) {
    return (
      <div data-inspector-terrain="none">
        <SectionHeader>{t("terrain.cardTitle")}</SectionHeader>
        <div className="flex flex-col px-3 py-1">
          <span className="text-md text-muted">{t("terrain.none")}</span>
          <span className="text-sm text-faint">{t("terrain.noneHint")}</span>
        </div>
      </div>
    );
  }
  const { tileset, set } = found;
  const setRef = { tilesetId: tileset.id, setId: set.id };
  return (
    <div data-inspector-terrain={found.terrain.name}>
      <SectionHeader>{t("terrain.cardTitle")}</SectionHeader>
      <div className="px-3 py-1">
        <TerrainPickerMenu doc={ctx.doc} value={choice} triggerClass={selectTriggerClass} label={t("terrain.brush")} placeholder={t("toolOptions.pickTerrain")} />
      </div>
      <label className="flex h-8 cursor-pointer items-center gap-2 px-3 text-md text-text">
        <input type="checkbox" role="switch" checked={active} data-terrain-autotile="" onChange={(e) => setAutotile(e.target.checked)} className="accent-[var(--color-accent)]" />
        {t("terrain.autotile")}
      </label>
      <div className="flex justify-center px-3 py-2">
        <TerrainPreview tileset={tileset} set={set} terrainId={choice.terrainId} />
      </div>
      <CardDivider />
      <div className="flex h-7 items-center gap-2 px-3">
        {renaming ? (
          <RenameInput
            initial={set.name}
            label={t("terrain.setName")}
            onDone={(name) => {
              setRenaming(false);
              if (name !== null) renameTerrainSet(setRef, name);
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted" title={t("terrain.renameHint")} onDoubleClick={() => setRenaming(true)} data-terrain-set-name="">
            {set.name}
          </span>
        )}
        <span className="shrink-0 text-2xs text-faint">{t(set.kind === "corner" ? "terrain.kindCorner" : "terrain.kindBlob")}</span>
      </div>
      <ul className="flex flex-col px-1.5" aria-label={set.name}>
        {set.terrains.map((terrain) => {
          const ref = { ...setRef, terrainId: terrain.id };
          const on = terrain.id === choice.terrainId;
          return (
            <li key={terrain.id} className={`group flex h-7 items-center gap-2 rounded-sm pr-1 pl-1.5 ${on ? "bg-accent-soft" : "hover:bg-hover"}`} data-terrain-row={terrain.name}>
              <input
                type="color"
                aria-label={t("terrain.color")}
                value={terrain.color}
                onChange={(e) => setTerrainColor(ref, e.target.value)}
                className="size-4 shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0"
              />
              <button type="button" onClick={() => chooseTerrain(ref)} className={`min-w-0 flex-1 truncate text-left text-sm ${on ? "text-text" : "text-muted"}`}>
                {terrain.name}
              </button>
            </li>
          );
        })}
      </ul>
      <PropGrid>
        <PropRow label={t("terrain.background")}>
          <MenuSelect label={t("terrain.background")} dataAttr="data-terrain-set-background" value={set.background ?? 0} options={backgroundOptions(set)} onChange={(bg) => setTerrainBackground(setRef, bg)} />
        </PropRow>
      </PropGrid>
      <div className="flex gap-2 px-3 pt-1">
        <ActionButton label={t("terrain.fix")} icon="sliders" dataAction="terrain-fix" onClick={() => startFix(choice)} />
        <ActionButton label={t("terrain.removeSet")} icon="trash" tone="danger" dataAction="terrain-remove-set" onClick={() => removeTerrainSet(setRef)} />
      </div>
    </div>
  );
}

/** The ARAZİ card (registered by the inspector for mode "terrain"). */
export function TerrainCard({ ctx }: { ctx: InspectorContext }) {
  const draft = useTerrainDraft((s) => s.draft);
  const fix = useTerrainDraft((s) => s.fix);
  if (draft) return <DefineFace ctx={ctx} draft={draft} />;
  if (fix && resolveTerrain(ctx.doc, fix)) return <FixFace ctx={ctx} fix={fix} />;
  return <BrushFace ctx={ctx} />;
}
