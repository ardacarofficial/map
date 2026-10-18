import type { Collection, Tileset } from "@smap/core";
import { useEffect, useRef } from "react";

import { gotoTileset } from "../../../commands/tilesetActions";
import { t } from "../../../i18n";
import { createPalette, setPaletteColumnCount, showPalette } from "../../palettes/paletteActions";
import { MAX_PALETTE_COLUMNS, MIN_PALETTE_COLUMNS } from "../../palettes/paletteModel";
import { Button, IconButton } from "../../primitives/Button";
import { Divider } from "../../primitives/Divider";
import { Icon } from "../../primitives/Icon";
import { Segmented } from "../../primitives/Segmented";
import { TextField } from "../../primitives/TextField";
import { Tooltip } from "../../primitives/Tooltip";
import { usePaletteStore } from "../../palettes/paletteStore";
import { bestMatch } from "../libraryModel";
import { TilesetSwitcher } from "../TilesetSwitcher";
import { useTilesetView } from "../tilesetViewStore";
import { PaletteDropChips } from "./PaletteDropChips";
import { useHeaderLabels } from "./useHeaderLabels";
import { ZoomControl, type ZoomProps } from "./ZoomControl";

function LibrarySearch({ tilesets }: { tilesets: readonly Tileset[] }) {
  const query = useTilesetView((s) => s.query);
  const focusNonce = useTilesetView((s) => s.searchFocus);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusNonce > 0) ref.current?.focus(); }, [focusNonce]);
  return <TextField size="sm" leadingIcon="search" ref={ref} value={query} className="w-50 max-w-full" data-tileset-search
    placeholder={t("tilesetLib.search")} aria-label={t("tilesetLib.search")} spellCheck={false}
    onChange={(e) => useTilesetView.getState().setQuery(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === "Enter") { e.preventDefault(); const best = bestMatch(tilesets, query); if (best) gotoTileset(best.id); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); useTilesetView.getState().setQuery(""); }
    }} />;
}

function PaletteColumns({ palette }: { palette: Collection }) {
  return <div className="flex shrink-0 items-center gap-1 text-sm text-muted" data-palette-columns>
    <span>{t("palettes.columns")}</span>
    <IconButton size="sm" aria-label={t("palettes.columnsLess")} disabled={palette.columns <= MIN_PALETTE_COLUMNS} onClick={() => setPaletteColumnCount(palette.id, palette.columns - 1)}><Icon name="minus" /></IconButton>
    <span className="font-mono text-text">{palette.columns}</span>
    <IconButton size="sm" aria-label={t("palettes.columnsMore")} disabled={palette.columns >= MAX_PALETTE_COLUMNS} onClick={() => setPaletteColumnCount(palette.id, palette.columns + 1)}><Icon name="plus" /></IconButton>
  </div>;
}

export function DockHeader({ tilesets, palettes, active, palette, onSelect, ...zoom }: ZoomProps & {
  tilesets: readonly Tileset[]; palettes: readonly Collection[]; active: Tileset; palette: Collection | null;
  onSelect(id: string): void;
}) {
  const dragging = usePaletteStore(s => s.drag !== null && palettes.length > 0);
  const view = useTilesetView((s) => s.view);
  const ref = useRef<HTMLDivElement>(null);
  const { view: viewLabels } = useHeaderLabels(ref);
  const label = (text: string, visible: boolean) => <span data-header-label className={`w-max shrink-0 whitespace-nowrap ${visible ? "" : "pointer-events-none invisible absolute"}`}>{text}</span>;
  return <div ref={ref} aria-label={t("tilesetDock.side")} data-tileset-side className={`flex h-8 min-w-0 shrink-0 items-center overflow-x-auto gap-2 border-b border-line-subtle bg-panel px-2 ${dragging ? "dock-tileset-drag" : ""}`}>
    <div data-header-flexible className="min-w-24 max-w-50 flex-1">{view === "all" ? <LibrarySearch tilesets={tilesets} /> : <TilesetSwitcher tilesets={tilesets} palettes={palettes} active={active} palette={palette} onSelect={(id) => { showPalette(null); onSelect(id); }} onSelectPalette={showPalette} onNewPalette={() => void createPalette()} />}</div>
    <Divider orientation="vertical" length={16} />
    {palette && <PaletteColumns palette={palette} />}
    <Segmented size="sm" label={t("tilesetLib.view")} data-header-group="view" value={view} onValueChange={(v) => useTilesetView.getState().setView(v)} className="shrink-0" items={[
      { value: "single", icon: "image", label: label(t("tilesetLib.viewSingle"), viewLabels), tooltip: t("tilesetLib.viewSingleTitle"), attrs: { "data-library-view": "single" } },
      { value: "all", icon: "layers", label: label(t("tilesetLib.viewAll"), viewLabels), tooltip: t("tilesetLib.viewAllTitle"), attrs: { "data-library-view": "all" } },
    ]} />
    <div className="ml-auto" />
    <div data-dock-palette-targets className={dragging ? "flex min-w-0 flex-1" : "contents"}><PaletteDropChips palettes={palettes} /></div>
    <Tooltip label={t("palettes.new")}><Button variant="ghost" size="sm" className="shrink-0" data-palette-new onClick={() => void createPalette()}><Icon name="plus" />{t("palettes.newShort")}</Button></Tooltip>
    <ZoomControl {...zoom} stack={view === "all"} />
  </div>;
}
