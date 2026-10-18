import { ContextMenu } from "@base-ui/react/context-menu";
import { Popover } from "@base-ui/react/popover";
import { Menu } from "@base-ui/react/menu";
import type { Collection, Tileset } from "@smap/core";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { openTilesetImport } from "../../commands/tilesetActions";
import { t } from "../../i18n";
import { useTilesetImage } from "../hooks";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { menuGroupLabelClass, menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { Tooltip } from "../primitives/Tooltip";
import { TextField } from "../primitives/TextField";
import { useTilesetView } from "./tilesetViewStore";
import { filterTilesets, groupTilesets, UNGROUPED } from "./libraryModel";
import { PaletteMenuItems } from "../palettes/PaletteGrid";
import { TilesetMenuItems } from "./TilesetMenu";

/** The whole tileset image shrunk into a `size` px square (crisp, centred). */
export function TilesetThumb({ tileset, size }: { tileset: Tileset; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const image = useTilesetImage(tileset.id);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!image) return;
    const { width, height } = image.bitmap;
    const scale = Math.min(canvas.width / width, canvas.height / height);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(image.bitmap, Math.floor((canvas.width - w) / 2), Math.floor((canvas.height - h) / 2), w, h);
  }, [image, size]);
  return <canvas ref={ref} aria-hidden style={{ width: size, height: size }} className="checker shrink-0 rounded-xs border border-line-subtle pixelated" />;
}

/** Right click on a tileset's header / switcher: the tileset menu. */
export function TilesetContextMenu({ tileset, children }: { tileset: Tileset; children: ReactNode }) {
  return (
    <ContextMenu.Root>
      {children}
      <ContextMenu.Portal>
        <ContextMenu.Positioner className={menuPositionerClass}>
          <ContextMenu.Popup className={menuPopupClass} data-tileset-context-menu={tileset.id}>
            <TilesetMenuItems tileset={tileset} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** Shared trailing actions for switcher rows and stacked source headers. */
export function SourceMenuButton({ tileset, palette, className = "", onAction }: { tileset?: Tileset; palette?: Collection; className?: string; onAction?(): void }) {
  const label = t(palette ? "palettes.menu" : "tilesetPanel.menu");
  // Dismiss the switcher with a leaf action, before its rows can change size
  // under the nested menu's floating-position observers.
  return <Menu.Root onOpenChange={(open, details) => { if (!open && details.reason === "item-press") onAction?.(); }}>
    <Menu.Trigger render={<IconButton size="sm" aria-label={label} data-tileset-menu={tileset?.id} data-palette-menu={palette?.id} className={className} onClick={(e) => e.stopPropagation()}><Icon name="more" /></IconButton>} />
    <Menu.Portal><Menu.Positioner side="bottom" align="end" sideOffset={4} className={menuPositionerClass}><Menu.Popup className={menuPopupClass}>
      {tileset ? <TilesetMenuItems tileset={tileset} /> : palette ? <PaletteMenuItems palette={palette} /> : null}
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}

export function TilesetSwitcher({ tilesets, palettes = [], active, palette = null, onSelect, onSelectPalette, onNewPalette }: {
  tilesets: readonly Tileset[]; palettes?: readonly Collection[]; active: Tileset; palette?: Collection | null;
  onSelect(id: string): void; onSelectPalette?(id: string): void; onNewPalette?(): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const shown = filterTilesets(tilesets, query);
  const shownPalettes = filterTilesets(palettes, query);
  const groups = groupTilesets(shown);
  const ordered = groups.flatMap((g) => g.tilesets);
  const keys = [...ordered.map((ts) => ts.id), ...shownPalettes.map((p) => `palette:${p.id}`)];
  const labelled = groups.some((g) => g.name !== UNGROUPED) || shownPalettes.length > 0;
  const choose = (key: string) => {
    if (key.startsWith("palette:")) onSelectPalette?.(key.slice(8)); else onSelect(key);
    setOpen(false);
  };
  useEffect(() => {
    rowsRef.current?.querySelector(`[data-switcher-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlight]);
  const name = palette?.name ?? active.name;
  const tooltip = palette ? name : `${name} · ${t("tilesetDock.tileSize", { width: active.tileWidth, height: active.tileHeight })} · ${active.columns}×${active.rows}`;
  const dropdown = <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) { setQuery(""); setHighlight(0); } }}>
    <Tooltip label={tooltip}><Popover.Trigger aria-label={t("tilesetPanel.switcher")} data-tileset-switcher className="flex h-control-sm w-full min-w-0 max-w-50 items-center gap-1 rounded-sm border border-line bg-field px-1 text-sm text-text hover:border-line-strong">
      {palette ? <Icon name="grid" /> : <TilesetThumb tileset={active} size={16} />}
      <span className="min-w-0 flex-1 truncate text-left" data-tileset-switcher-name>{name}</span><Icon name="chevron-down" size={12} className="shrink-0 text-faint" />
    </Popover.Trigger></Tooltip>
    <Popover.Portal><Popover.Positioner side="bottom" align="start" sideOffset={4} className={menuPositionerClass}>
      <Popover.Popup initialFocus={searchRef} className={`${menuPopupClass} flex max-h-[min(420px,var(--available-height))] w-70 flex-col`}>
        <TextField ref={searchRef} size="sm" leadingIcon="search" value={query} data-tileset-switcher-search aria-label={t("tilesetLib.search")} placeholder={t("tilesetLib.search")} className="mb-1 shrink-0"
          onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setHighlight((i) => keys.length ? (i + (e.key === "ArrowDown" ? 1 : keys.length - 1)) % keys.length : 0); }
            else if (e.key === "Enter" && keys[highlight]) { e.preventDefault(); choose(keys[highlight]!); }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
          }} />
        <div ref={rowsRef} className="min-h-0 overflow-y-auto">
          {groups.map((g) => <Fragment key={g.name}>
            {labelled && <div className={menuGroupLabelClass} data-switcher-group={g.name}>{g.name === UNGROUPED ? t(palettes.length ? "tilesetDock.tilesets" : "tilesetLib.ungrouped") : g.name}</div>}
            {g.tilesets.map((ts) => {
              const current = !palette && ts.id === active.id;
              const index = keys.indexOf(ts.id);
              return <div key={ts.id} data-switcher-index={index} className={`group flex h-row items-center gap-1 rounded-sm ${current ? "bg-active" : index === highlight ? "bg-hover-popup" : "hover:bg-hover-popup"}`} onMouseEnter={() => setHighlight(index)}>
                <button type="button" data-tileset-option={ts.id} onClick={() => choose(ts.id)} className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2 text-left text-sm">
                  <TilesetThumb tileset={ts} size={16} /><span className="min-w-0 flex-1 truncate">{ts.name}</span>
                  <span className="shrink-0 font-mono text-xs text-muted">{t("tilesetPanel.tilesetMeta", { columns: ts.columns, rows: ts.rows, size: ts.tileWidth === ts.tileHeight ? ts.tileWidth : `${ts.tileWidth}×${ts.tileHeight}` })}</span>
                  {current && <Icon name="tick" size={12} />}
                </button>
                <SourceMenuButton tileset={ts} onAction={() => setOpen(false)} className={current || index === highlight ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"} />
              </div>;
            })}
          </Fragment>)}
          {shownPalettes.length > 0 && <div className={menuGroupLabelClass}>{t("palettes.title")}</div>}
          {shownPalettes.map((p) => {
            const index = keys.indexOf(`palette:${p.id}`);
            const current = p.id === palette?.id;
            return <div key={p.id} data-switcher-index={index} onMouseEnter={() => setHighlight(index)} className={`group flex h-row items-center gap-1 rounded-sm ${current ? "bg-active" : highlight === index ? "bg-hover-popup" : "hover:bg-hover-popup"}`}>
              <button type="button" data-palette-option={p.id} onClick={() => choose(`palette:${p.id}`)} className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2 text-left text-sm"><Icon name="grid" /><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="text-xs text-faint">{t("palettes.tileCount", { count: p.cells.length })}</span>{current && <Icon name="tick" size={12} />}</button>
              <SourceMenuButton palette={p} onAction={() => setOpen(false)} className={current || index === highlight ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"} />
            </div>;
          })}
          {keys.length === 0 && <div className="px-2 text-sm text-muted">{t("tilesetLib.noMatch")}</div>}
        </div>
        <div className={menuSeparatorClass} />
        <button type="button" className={`${menuItemClass} shrink-0 hover:bg-hover-popup`} data-tileset-view-all onClick={() => { useTilesetView.getState().setView("all"); setOpen(false); }}><Icon name="layers" />{t("tilesetLib.viewAll")}</button>
        <button type="button" className={`${menuItemClass} shrink-0 hover:bg-hover-popup`} data-tileset-add onClick={() => { setOpen(false); void openTilesetImport(); }}><Icon name="image-up" />{t("tilesetPanel.add")}</button>
        <button type="button" className={`${menuItemClass} shrink-0 hover:bg-hover-popup`} data-palette-option={"\u0000new"} onClick={() => { setOpen(false); onNewPalette?.(); }}><Icon name="plus" />{t("palettes.newMenu")}</button>
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>;
  return palette ? <ContextMenu.Root><ContextMenu.Trigger className="flex min-w-0 flex-1">{dropdown}</ContextMenu.Trigger><ContextMenu.Portal><ContextMenu.Positioner className={menuPositionerClass}><ContextMenu.Popup className={menuPopupClass}><PaletteMenuItems palette={palette} /></ContextMenu.Popup></ContextMenu.Positioner></ContextMenu.Portal></ContextMenu.Root>
    : <TilesetContextMenu tileset={active}><ContextMenu.Trigger className="flex min-w-0 flex-1">{dropdown}</ContextMenu.Trigger></TilesetContextMenu>;
}
