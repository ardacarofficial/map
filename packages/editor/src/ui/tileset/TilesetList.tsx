/**
 * "Tileset'ler" list for the library column (round 4): one card per
 * tileset (thumbnail, name, size, group) and per palette. A click picks
 * what the bottom dock's Tileset tab shows (and opens that tab); right
 * click opens the tileset / palette menu. Palette cards also take dragged
 * tiles (drop = add to that palette).
 */
import { ContextMenu } from "../primitives/Overlays";
import type { Collection, Tileset } from "@smap/core";

import { openTilesetImport } from "../../commands/tilesetActions";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { showDockTab } from "../layout/dock/BottomDock";
import { createPalette, showPalette } from "../palettes/paletteActions";
import { PaletteMenuItems } from "../palettes/PaletteGrid";
import { usePaletteStore } from "../palettes/paletteStore";
import { Icon } from "../primitives/Icon";
import { menuPopupClass, menuPositionerClass } from "../primitives/menuStyles";
import { useUiStore } from "../uiStore";
import { filterTilesets, groupTilesets, UNGROUPED } from "./libraryModel";
import { TilesetContextMenu, TilesetThumb } from "./TilesetSwitcher";

/** Shows tileset `id` in the dock's Tileset tab. */
export function showTilesetInDock(id: string): void {
  showPalette(null);
  useUiStore.getState().setActiveTileset(id);
  showDockTab("tileset");
}

/** Shows palette `id` in the dock's Tileset tab. */
export function showPaletteInDock(id: string): void {
  showPalette(id);
  showDockTab("tileset");
}

/** The list (`query` filters by name). */
export function TilesetList({ query = "" }: { query?: string }) {
  const store = useEditorStore((s) => s.project?.store);
  useStructureVersion(store);
  const activeId = useUiStore((s) => s.activeTilesetId);
  const paletteId = usePaletteStore((s) => s.activePaletteId);
  const dragging = usePaletteStore((s) => s.drag !== null);
  const dropId = usePaletteStore((s) => (s.drag?.target && !s.drag.target.slot ? s.drag.target.paletteId : null));
  const tilesets = filterTilesets(store?.document.tilesets ?? [], query);
  const palettes = filterTilesets(store?.document.collections ?? [], query);
  const groups = groupTilesets(tilesets);
  const shownTileset = paletteId ? null : (activeId ?? store?.document.tilesets[0]?.id ?? null);

  if (!store) return null;
  if ((store.document.tilesets.length ?? 0) === 0) {
    return (
      <button
        type="button"
        onClick={() => void openTilesetImport()}
        data-tileset-list-empty
        className="mx-3 my-2 flex flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-8 text-center transition-colors hover:border-accent-line hover:bg-accent-soft/40"
      >
        <Icon name="image" size={22} className="text-faint" />
        <span className="text-md text-muted">{t("tilesetList.empty")}</span>
        <span className="text-xs text-accent">{t("tilesetList.add")}</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 pb-3" data-tileset-list>
      {groups.map((g) => (
        <section key={g.name || "\u0000"} aria-label={g.name || t("tilesetList.label")} className="flex flex-col gap-1.5">
          <h3 className="text-2xs font-semibold tracking-[.06em] text-faint uppercase">{g.name === UNGROUPED ? t("tilesetList.label") : g.name}</h3>
          <div className="grid grid-cols-2 gap-2">
            {g.tilesets.map((ts) => (
              <TilesetCard key={ts.id} tileset={ts} shown={ts.id === shownTileset} />
            ))}
          </div>
        </section>
      ))}
      <section aria-label={t("tilesetList.palettes")} className="flex flex-col gap-1.5">
        <h3 className="flex items-center text-2xs font-semibold tracking-[.06em] text-faint uppercase">
          {t("tilesetList.palettes")}
          <button
            type="button"
            onClick={() => void createPalette().then((id) => id && showDockTab("tileset"))}
            className="ml-auto flex h-5 items-center gap-0.5 rounded-sm px-1 text-2xs font-normal tracking-normal text-muted normal-case hover:bg-hover hover:text-text"
            data-tileset-list-new-palette
          >
            <Icon name="plus" size={11} />
            {t("palettes.new")}
          </button>
        </h3>
        {palettes.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {palettes.map((p) => (
              <PaletteCard key={p.id} palette={p} shown={p.id === paletteId} dragging={dragging} over={dropId === p.id} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const cardClass = (shown: boolean) =>
  `group flex min-w-0 flex-col overflow-hidden rounded-md border text-left transition-colors ${
    shown ? "border-accent-line bg-accent-soft" : "border-line bg-raised hover:border-line-strong hover:bg-hover"
  }`;

function TilesetCard({ tileset, shown }: { tileset: Tileset; shown: boolean }) {
  const size = tileset.tileWidth === tileset.tileHeight ? tileset.tileWidth : `${tileset.tileWidth}×${tileset.tileHeight}`;
  return (
    <TilesetContextMenu tileset={tileset}>
      <ContextMenu.Trigger
        render={
          <button
            type="button"
            aria-pressed={shown}
            title={shown ? t("tilesetList.shown") : t("tilesetList.show")}
            data-tileset-card={tileset.id}
            onClick={() => showTilesetInDock(tileset.id)}
            className={cardClass(shown)}
          />
        }
      >
        <span className="grid h-[72px] place-items-center border-b border-line-subtle bg-canvas/60">
          <TilesetThumb tileset={tileset} size={64} />
        </span>
        <span className="flex min-w-0 flex-col px-2 py-1.5 leading-tight">
          <span className={`truncate text-sm ${shown ? "text-text" : "text-muted group-hover:text-text"}`}>{tileset.name}</span>
          <span className="truncate font-mono text-2xs text-faint tabular">{t("tilesetList.meta", { columns: tileset.columns, rows: tileset.rows, size })}</span>
        </span>
      </ContextMenu.Trigger>
    </TilesetContextMenu>
  );
}

function PaletteCard({ palette, shown, dragging, over }: { palette: Collection; shown: boolean; dragging: boolean; over: boolean }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={
          <button
            type="button"
            aria-pressed={shown}
            data-palette-card={palette.id}
            data-palette-drop={palette.id}
            onClick={() => showPaletteInDock(palette.id)}
            className={`${cardClass(shown)} ${over ? "border-accent! bg-accent/20!" : dragging ? "border-dashed border-accent-line" : ""}`}
          />
        }
      >
        <span className="checker grid h-10 place-items-center border-b border-line-subtle text-faint">
          <Icon name="grid" size={16} />
        </span>
        <span className="flex min-w-0 flex-col px-2 py-1.5 leading-tight">
          <span className={`truncate text-sm ${shown ? "text-text" : "text-muted group-hover:text-text"}`}>{palette.name}</span>
          <span className="truncate text-2xs text-faint">{t("palettes.meta", { count: palette.cells.length, columns: palette.columns })}</span>
        </span>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className={menuPositionerClass}>
          <ContextMenu.Popup className={menuPopupClass}>
            <PaletteMenuItems palette={palette} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
