import { Menu } from "@base-ui/react/menu";
import type { Tileset } from "@smap/core";
import { useEffect, useRef } from "react";

import { openTilesetImport, openTilesetSettings, replaceTilesetImage } from "../../commands/tilesetActions";
import { t } from "../../i18n";
import { useTilesetImage } from "../hooks";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { Tooltip } from "../primitives/Tooltip";

/** The whole tileset image shrunk into a `size` px square (crisp, centred). */
function TilesetThumb({ tileset, size }: { tileset: Tileset; size: number }) {
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

/**
 * Tileset row under the library tabs: a dropdown (thumbnail + name) to
 * switch tilesets, and a "⋯" menu (settings, replace image, add).
 */
export function TilesetSwitcher({
  tilesets,
  active,
  onSelect,
}: {
  tilesets: readonly Tileset[];
  active: Tileset;
  onSelect(id: string): void;
}) {
  const many = tilesets.length > 1;
  return (
    <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5">
      <Menu.Root>
        <Menu.Trigger
          disabled={!many}
          aria-label={t("tilesetPanel.switcher")}
          data-tileset-switcher
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-raised pr-1.5 pl-1.5 text-left transition-colors hover:border-line-strong data-disabled:cursor-default data-disabled:hover:border-line data-popup-open:border-line-strong"
        >
          <TilesetThumb tileset={active} size={20} />
          <span className="min-w-0 flex-1 truncate text-md text-text">{active.name}</span>
          <span className="shrink-0 font-mono text-2xs text-faint tabular">
            {active.columns}×{active.rows}
          </span>
          {many && <Icon name="chevronDown" size={14} className="shrink-0 text-faint" />}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="start" sideOffset={4} className={menuPositionerClass}>
            <Menu.Popup className={`${menuPopupClass} max-h-[min(420px,var(--available-height))] w-(--anchor-width) min-w-[220px] overflow-y-auto`}>
              {tilesets.map((ts) => (
                <Menu.Item
                  key={ts.id}
                  className={`${menuItemClass} ${ts.id === active.id ? "bg-active" : ""}`}
                  data-tileset-option={ts.id}
                  onClick={() => onSelect(ts.id)}
                >
                  <TilesetThumb tileset={ts} size={28} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate">{ts.name}</span>
                    <span className="font-mono text-2xs text-faint tabular">
                      {t("tilesetPanel.tilesetMeta", { columns: ts.columns, rows: ts.rows, size: ts.tileWidth === ts.tileHeight ? ts.tileWidth : `${ts.tileWidth}×${ts.tileHeight}` })}
                    </span>
                  </span>
                  {ts.id === active.id && <Icon name="check" size={14} className="shrink-0 text-accent" />}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <Menu.Root>
        <Tooltip label={t("tilesetPanel.menu")}>
          <Menu.Trigger
            render={
              <IconButton aria-label={t("tilesetPanel.menu")} data-tileset-menu className="size-8 data-popup-open:bg-hover data-popup-open:text-text">
                <Icon name="more" size={15} />
              </IconButton>
            }
          />
        </Tooltip>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} className={menuPositionerClass}>
            <Menu.Popup className={menuPopupClass}>
              <Menu.Item className={menuItemClass} onClick={() => void openTilesetSettings(active.id)}>
                <Icon name="grid" size={15} className="text-muted" />
                {t("tilesetPanel.settings")}
              </Menu.Item>
              <Menu.Item className={menuItemClass} onClick={() => void replaceTilesetImage(active.id)}>
                <Icon name="image" size={15} className="text-muted" />
                {t("tilesetPanel.replaceImage")}
              </Menu.Item>
              <div role="separator" className={menuSeparatorClass} />
              <Menu.Item className={menuItemClass} onClick={() => void openTilesetImport()}>
                <Icon name="plus" size={15} className="text-muted" />
                {t("tilesetPanel.add")}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
