import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
import type { Collection, Tileset } from "@smap/core";
import { Fragment, useEffect, useRef, type ReactNode } from "react";

import { openTilesetImport } from "../../commands/tilesetActions";
import { t } from "../../i18n";
import { useTilesetImage } from "../hooks";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { Tooltip } from "../primitives/Tooltip";
import { groupTilesets, UNGROUPED } from "./libraryModel";
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

/**
 * The tileset / palette switcher: a dropdown (thumbnail + name, grouped,
 * then the palettes and "+ Yeni palet") and a "⋯" menu (the shown
 * tileset's settings, replace image, group, remove, add — or the shown
 * palette's rename / delete). Right click on the dropdown opens the same
 * menu. `compact` (the dock): two lines, name ▾ over `meta` ("16 × 16 px").
 */
export function TilesetSwitcher({
  tilesets,
  palettes = [],
  active,
  palette = null,
  onSelect,
  onSelectPalette,
  onNewPalette,
  compact = false,
  meta,
}: {
  tilesets: readonly Tileset[];
  palettes?: readonly Collection[];
  active: Tileset;
  /** The palette shown instead of `active`, or null. */
  palette?: Collection | null;
  onSelect(id: string): void;
  onSelectPalette?(id: string): void;
  onNewPalette?(): void;
  compact?: boolean;
  /** Second line in compact mode. */
  meta?: ReactNode;
}) {
  const groups = groupTilesets(tilesets);
  const labelled = groups.some((g) => g.name !== UNGROUPED) || palettes.length > 0;
  const name = palette ? palette.name : active.name;
  const trigger = (
    <Menu.Trigger
      aria-label={t("tilesetPanel.switcher")}
      data-tileset-switcher
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-raised pr-1.5 pl-1.5 text-left transition-colors hover:border-line-strong data-popup-open:border-line-strong ${
        compact ? "h-10" : "h-8"
      }`}
    >
      {palette ? (
        <span className="checker grid size-5 shrink-0 place-items-center rounded-xs border border-line-subtle text-muted">
          <Icon name="grid" size={12} />
        </span>
      ) : (
        <TilesetThumb tileset={active} size={compact ? 24 : 20} />
      )}
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-md text-text" title={name} data-tileset-switcher-name>
          {name}
        </span>
        {compact && meta && <span className="truncate text-2xs text-faint">{meta}</span>}
      </span>
      {!compact && !palette && (
        <span className="shrink-0 font-mono text-2xs text-faint tabular">
          {active.columns}×{active.rows}
        </span>
      )}
      <Icon name="chevronDown" size={14} className="shrink-0 text-faint" />
    </Menu.Trigger>
  );
  const dropdown = (
    <Menu.Root>
      {trigger}
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} max-h-[min(420px,var(--available-height))] w-(--anchor-width) min-w-[220px] overflow-y-auto`}>
            {groups.map((g) => (
              <Fragment key={g.name}>
                {labelled && (
                  <div className="px-2 pt-2 pb-1 text-2xs font-semibold tracking-wide text-faint" data-switcher-group={g.name}>
                    {g.name === UNGROUPED ? (palettes.length > 0 ? t("tilesetDock.tilesets") : t("tilesetLib.ungrouped")) : g.name}
                  </div>
                )}
                {g.tilesets.map((ts) => (
                  <Menu.Item
                    key={ts.id}
                    className={`${menuItemClass} ${!palette && ts.id === active.id ? "bg-active" : ""}`}
                    data-tileset-option={ts.id}
                    onClick={() => onSelect(ts.id)}
                  >
                    <TilesetThumb tileset={ts} size={28} />
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate">{ts.name}</span>
                      <span className="font-mono text-2xs text-faint tabular">
                        {t("tilesetPanel.tilesetMeta", {
                          columns: ts.columns,
                          rows: ts.rows,
                          size: ts.tileWidth === ts.tileHeight ? ts.tileWidth : `${ts.tileWidth}×${ts.tileHeight}`,
                        })}
                      </span>
                    </span>
                    {!palette && ts.id === active.id && <Icon name="check" size={14} className="shrink-0 text-accent" />}
                  </Menu.Item>
                ))}
              </Fragment>
            ))}
            {onSelectPalette && (
              <>
                <div className="px-2 pt-2 pb-1 text-2xs font-semibold tracking-wide text-faint" data-switcher-group="palettes">
                  {t("palettes.title")}
                </div>
                {palettes.map((p) => (
                  <Menu.Item
                    key={p.id}
                    className={`${menuItemClass} ${palette?.id === p.id ? "bg-active" : ""}`}
                    data-palette-option={p.id}
                    onClick={() => onSelectPalette(p.id)}
                  >
                    <span className="checker grid size-7 shrink-0 place-items-center rounded-xs border border-line-subtle text-muted">
                      <Icon name="grid" size={14} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate">{p.name}</span>
                      <span className="text-2xs text-faint">{t("palettes.meta", { count: p.cells.length, columns: p.columns })}</span>
                    </span>
                    {palette?.id === p.id && <Icon name="check" size={14} className="shrink-0 text-accent" />}
                  </Menu.Item>
                ))}
                {onNewPalette && (
                  <Menu.Item className={menuItemClass} data-palette-option="\u0000new" onClick={onNewPalette}>
                    <Icon name="plus" size={15} className="text-accent" />
                    {t("palettes.newMenu")}
                  </Menu.Item>
                )}
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1">
      {palette ? (
        <ContextMenu.Root>
          <ContextMenu.Trigger className="flex min-w-0 flex-1">{dropdown}</ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Positioner className={menuPositionerClass}>
              <ContextMenu.Popup className={menuPopupClass}>
                <PaletteMenuItems palette={palette} />
              </ContextMenu.Popup>
            </ContextMenu.Positioner>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      ) : (
        <TilesetContextMenu tileset={active}>
          <ContextMenu.Trigger className="flex min-w-0 flex-1">{dropdown}</ContextMenu.Trigger>
        </TilesetContextMenu>
      )}
      <Menu.Root>
        <Tooltip label={palette ? t("palettes.menu") : t("tilesetPanel.menu")}>
          <Menu.Trigger
            render={
              <IconButton aria-label={palette ? t("palettes.menu") : t("tilesetPanel.menu")} data-tileset-menu className={`${compact ? "size-7" : "size-8"} data-popup-open:bg-hover data-popup-open:text-text`}>
                <Icon name="more" size={15} />
              </IconButton>
            }
          />
        </Tooltip>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} className={menuPositionerClass}>
            <Menu.Popup className={menuPopupClass}>
              {palette ? <PaletteMenuItems palette={palette} /> : <TilesetMenuItems tileset={active} />}
              <div role="separator" className={menuSeparatorClass} />
              <Menu.Item className={menuItemClass} onClick={() => void openTilesetImport()}>
                <Icon name="plus" size={15} className="text-muted" />
                {t("tilesetPanel.add")}
              </Menu.Item>
              {onNewPalette && (
                <Menu.Item className={menuItemClass} data-palette-new-menu onClick={onNewPalette}>
                  <Icon name="grid" size={15} className="text-muted" />
                  {t("palettes.newMenu")}
                </Menu.Item>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
