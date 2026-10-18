/**
 * Denetçi ARAZİ card (concept 11, "TERRAIN"): three faces.
 *
 * - Define (a rough rectangle was dragged in Arazi mode): the found
 *   template ("Şablon ▾" with the other candidates), the set to add to,
 *   name, colour, background and the 3×3 preview → "Tanımla" (one undo step).
 * - Fix ("Düzelt"): what clicks in the tileset do, and "Bitti".
 * - Dock editing: terrain list, preview, background, "Düzelt" / remove.
 * - Terrain brush: plain facts; painting controls live in the options bar.
 */
import { TERRAIN_COLORS, type TerrainSet, type Tileset } from "@smap/core";
import { useState, type ReactNode } from "react";

import {
  defineTerrain,
  removeTerrainSet,
  renameTerrainSet,
  setTerrainBackground,
  setTerrainColor,
} from "../../commands/terrainActions";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { Button } from "../primitives/Button";
import { Divider } from "../primitives/Divider";
import { Icon, type IconName } from "../primitives/Icon";
import { PropRow, PropValue } from "../primitives/PropRow";
import { SectionHeader } from "../primitives/SectionHeader";
import { TextField } from "../primitives/TextField";
import { Tooltip } from "../primitives/Tooltip";
import type { InspectorContext } from "../inspector/registry";
import { RenameInput } from "../primitives/RenameInput";
import { TileSwatch } from "../primitives/TileSwatch";
import { useUiStore } from "../uiStore";
import { clearTerrainDraft, startFix, useTerrainDraft, type TerrainDraft } from "./terrainDraft";
import { TerrainDot, TerrainSets } from "./TerrainList";
import { MenuSelect, type SelectOption } from "./TerrainMenus";
import { draftResult, kindOfTemplate, previewTiles, resolveTerrain, templateLabel, type TerrainRef } from "./terrainModel";

const CELL = 32;

function PropGrid({ children }: { children: ReactNode }) { return <div className="px-3">{children}</div>; }
function ActionButton({ label, icon, tone, dataAction, disabledReason, onClick }: {
  label: string; icon?: IconName; tone?: "primary" | "danger"; dataAction: string; disabledReason?: string | null; onClick(): void;
}) {
  const button = <Button size="sm" variant={tone === "primary" ? "primary" : "secondary"} className={tone === "danger" ? "text-danger" : ""} data-action={dataAction} disabled={!!disabledReason} onClick={onClick}>{icon && <Icon name={icon} />}{label}</Button>;
  return disabledReason ? <Tooltip label={disabledReason}>{button}</Tooltip> : button;
}

/** 3×3 tiles of `terrainId` around a full centre (what painting a blob looks like). */
export function TerrainPreview({ tileset, set, terrainId, cell = CELL }: { tileset: Tileset; set: TerrainSet; terrainId: number; cell?: number }) {
  const tiles = previewTiles(set, terrainId);
  const color = set.terrains.find((x) => x.id === terrainId)?.color ?? "var(--color-muted)";
  return (
    <div
      className="grid w-max gap-px rounded-md border border-line bg-line p-px"
      style={{ gridTemplateColumns: `repeat(3, ${cell}px)` }}
      data-terrain-preview=""
      data-terrain-preview-missing={tiles.filter((x) => x === null).length}
    >
      {tiles.map((tile, i) =>
        tile === null ? (
          <span key={i} className="checker opacity-60" style={{ width: cell, height: cell, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 33%, transparent)` }} />
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
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto" data-terrain-colors="">
      {TERRAIN_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          aria-pressed={c === value.toLowerCase()}
          onClick={() => onChange(c)}
          className={`size-4 shrink-0 rounded-xs border ${c === value.toLowerCase() ? "border-text" : "border-transparent"}`}
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        aria-label={t("terrain.color")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="size-6 cursor-pointer rounded-sm border border-line bg-transparent p-0"
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
      <SectionHeader padding={12} title={t("terrain.defineTitle")} />
      <Tooltip label={t(kind === "corner" ? "terrain.defineHintCorner" : "terrain.defineHintBlob")}><div className="flex px-3 py-2">
        {result ? <TerrainPreview tileset={tileset} set={result.set} terrainId={result.terrainId} /> : <span className="text-sm text-danger">{t("terrain.noFit")}</span>}
      </div></Tooltip>
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
          <TextField size="sm"
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
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
            className="min-w-0 flex-1"
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
      <SectionHeader padding={12} title={t("terrain.fixTitle", { name: found.terrain.name })} actions={<TerrainDot color={found.terrain.color} />} />
      <Tooltip label={t(found.set.kind === "corner" ? "terrain.fixHintCorner" : "terrain.fixHintBlob")}><div className="flex px-3 py-2">
        <TerrainPreview tileset={found.tileset} set={found.set} terrainId={fix.terrainId} />
      </div></Tooltip>
      <div className="px-3">
        <ActionButton
          label={t("tileset.done")}
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
  const [renaming, setRenaming] = useState(false);
  const found = resolveTerrain(ctx.doc, choice);
  if (!found || !choice) {
    return (
      <div data-inspector-terrain="none">
        <TerrainSets />
      </div>
    );
  }
  const { tileset, set } = found;
  const setRef = { tilesetId: tileset.id, setId: set.id };
  return (
    <div data-inspector-terrain={found.terrain.name}>
      <SectionHeader padding={12} title={t("terrain.cardTitle")} />
      <div className="flex px-3 py-2">
        <TerrainPreview tileset={tileset} set={set} terrainId={choice.terrainId} />
      </div>
      <Divider className="my-2" />
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
      <PropGrid>
        <PropRow label={t("terrain.background")}>
          <MenuSelect label={t("terrain.background")} dataAttr="data-terrain-set-background" value={set.background ?? 0} options={backgroundOptions(set)} onChange={(bg) => setTerrainBackground(setRef, bg)} />
        </PropRow>
      </PropGrid>
      <PropGrid><PropRow label={t("terrain.color")}><ColorRow value={found.terrain.color} onChange={(color) => setTerrainColor(choice, color)} /></PropRow></PropGrid>
      <TerrainSets separated />
      <div className="flex gap-2 px-3 pt-1">
        <ActionButton label={t("terrain.fix")} icon="sliders" dataAction="terrain-fix" onClick={() => startFix(choice)} />
        <ActionButton label={t("terrain.removeSet")} icon="trash" tone="danger" dataAction="terrain-remove-set" onClick={() => removeTerrainSet(setRef)} />
      </div>
    </div>
  );
}

/** Painting shows chosen-set facts; editing stays in the dock's Arazi context. */
function TerrainFacts({ ctx }: { ctx: InspectorContext }) {
  const choice = useEditorStore((s) => s.terrain);
  const found = resolveTerrain(ctx.doc, choice);
  if (!found) return null;
  return <div data-inspector-terrain={found.terrain.name}>
    <SectionHeader padding={12} title={t("terrain.cardTitle")} />
    <PropGrid>
      <PropRow label={t("terrain.name")}><PropValue align="left">{found.terrain.name}</PropValue></PropRow>
      <PropRow label={t("terrain.set")}><PropValue align="left">{found.set.name}</PropValue></PropRow>
      <PropRow label={t("terrain.template")}><PropValue align="left">{t(found.set.kind === "corner" ? "terrain.kindCorner" : "terrain.kindBlob")}</PropValue></PropRow>
      <PropRow label={t("terrain.tiles")}><PropValue align="left">{found.set.tiles.length}</PropValue></PropRow>
    </PropGrid>
  </div>;
}

/** The ARAZİ card (registered by the inspector for mode "terrain"). */
export function TerrainCard({ ctx }: { ctx: InspectorContext }) {
  const draft = useTerrainDraft((s) => s.draft);
  const fix = useTerrainDraft((s) => s.fix);
  const mode = useUiStore((s) => s.tilesetMode);
  if (draft) return <DefineFace ctx={ctx} draft={draft} />;
  if (fix && resolveTerrain(ctx.doc, fix)) return <FixFace ctx={ctx} fix={fix} />;
  if (mode !== "terrain") return <TerrainFacts ctx={ctx} />;
  return <BrushFace ctx={ctx} />;
}
