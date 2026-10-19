import type { Collection, Tileset } from "@smap/core";
import { useEffect, useRef, useState } from "react";

import { runCommand } from "../../../commands/registry";
import { requestPaletteTrim } from "../../palettes/paletteDialogsStore";
import { gotoTileset } from "../../../commands/tilesetActions";
import { t } from "../../../i18n";
import { createPalette, setPaletteRowCount, setPaletteColumnCount, showPalette } from "../../palettes/paletteActions";
import { MAX_PALETTE_COLUMNS, MIN_PALETTE_COLUMNS, paletteRows } from "../../palettes/paletteModel";
import { useEditorStore } from "../../../state/editorStore";
import { Button, IconButton } from "../../primitives/Button";
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
  const [refused, setRefused] = useState<number | null>(null);
  const [rows, setRows] = useState(String(paletteRows(palette)));
  const [columns, setColumns] = useState(String(palette.columns));
  useEffect(() => { setRows(String(paletteRows(palette))); setColumns(String(palette.columns)); setRefused(null); }, [palette]);
  const commitRows = () => {
    const value = Number(rows);
    if (value === paletteRows(palette)) return;
    if (!setPaletteRowCount(palette.id, value)) { setRefused(value); return; }
    setRefused(null);
    setRows(String(paletteRows(useEditorStore.getState().project?.store.document.getCollection(palette.id) ?? palette)));
  };
  const commitColumns = () => {
    const value = Number(columns);
    if (Number.isFinite(value)) setPaletteColumnCount(palette.id, value);
    setColumns(String(useEditorStore.getState().project?.store.document.getCollection(palette.id)?.columns ?? palette.columns));
  };
  return <div className="flex min-w-0 flex-col gap-1" data-palette-columns>
    <div className="flex flex-wrap items-center gap-1 text-sm text-muted">
      <label className="flex items-center gap-1">{t("tilesetEditing.columns")}
        <TextField size="sm" type="number" className="w-14" aria-label={t("tilesetEditing.columns")} data-palette-columns-input min={MIN_PALETTE_COLUMNS} max={MAX_PALETTE_COLUMNS} value={columns}
          onChange={e => setColumns(e.target.value)} onBlur={commitColumns} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitColumns(); } }} />
      </label>
      <label className="flex items-center gap-1">{t("tilesetEditing.rows")}
        <TextField size="sm" type="number" className="w-14" aria-label={t("tilesetEditing.rows")} data-palette-rows-input aria-invalid={refused !== null} min={1} max={Math.max(256, paletteRows(palette))} value={rows}
          onChange={e => { setRows(e.target.value); setRefused(null); }} onBlur={commitRows} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitRows(); } }} />
      </label>
    </div>
    {refused !== null && Number.isInteger(refused) && refused >= 1 && palette.cells.some(c => c.y >= refused) && <div className="flex flex-wrap items-center gap-1 text-sm text-muted">
      <span role="status">{t("tilesetEditing.occupied")}</span>
      <Button size="sm" className="h-auto min-h-control-sm max-w-full whitespace-normal text-left" onClick={() => requestPaletteTrim(palette, refused)}>{t("tilesetEditing.trim")}</Button>
    </div>}
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
  return <div aria-label={t("tilesetDock.side")} data-tileset-side className={`tileset-header flex min-w-0 shrink-0 flex-col border-b border-line-subtle bg-panel px-2 ${dragging ? "dock-tileset-drag" : ""}`}>
    <div className="tileset-header-source flex h-8 min-w-0 shrink-0 items-center gap-2">
      <div data-header-flexible className="min-w-0 max-w-50 flex-1">{view === "all" ? <LibrarySearch tilesets={tilesets} /> : <TilesetSwitcher tilesets={tilesets} palettes={palettes} active={active} palette={palette} onSelect={(id) => { showPalette(null); onSelect(id); }} onSelectPalette={showPalette} onNewPalette={() => void createPalette()} />}</div>
      <Tooltip label={t("palettes.new")}><IconButton size="sm" aria-label={t("palettes.new")} data-palette-new onClick={() => void createPalette()}><Icon name="plus" /></IconButton></Tooltip>
    </div>
    <div ref={ref} className="tileset-header-controls flex h-8 min-w-0 shrink-0 items-center gap-2">
      <Segmented size="sm" label={t("tilesetLib.view")} data-header-group="view" value={view} onValueChange={(v) => useTilesetView.getState().setView(v)} className="shrink-0" items={[
        { value: "single", icon: "image", label: label(t("tilesetLib.viewSingle"), viewLabels), tooltip: t("tilesetLib.viewSingleTitle"), attrs: { "data-library-view": "single", className: "tileset-header-view" } },
        { value: "all", icon: "layers", label: label(t("tilesetLib.viewAll"), viewLabels), tooltip: t("tilesetLib.viewAllTitle"), attrs: { "data-library-view": "all", className: "tileset-header-view" } },
      ]} />
      <div className="ml-auto" />
      <ZoomControl {...zoom} onZoom={value => view === "single" && value === null ? runCommand("tileset.fit") : zoom.onZoom(value)} stack={view === "all"} />
    </div>
    {palette && <div className="tileset-header-columns flex min-h-8 shrink-0 items-center py-1"><PaletteColumns palette={palette} /></div>}
    <div data-dock-palette-targets className={dragging ? "flex h-8 min-w-0 items-center" : "hidden"}><PaletteDropChips palettes={palettes} /></div>
  </div>;
}
