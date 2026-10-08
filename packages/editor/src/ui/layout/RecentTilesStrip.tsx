import type { MapDocument, TileClip } from "@smap/core";
import { useEffect, useRef, type ReactNode } from "react";

import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { isRecentStamp, recentKey, type RecentItem } from "../../state/recentItems";
import { getTilesetImage } from "../../state/tilesetImages";
import { useImageVersion, useStructureVersion } from "../hooks";
import { Icon } from "../primitives/Icon";
import { TileSwatch } from "../primitives/TileSwatch";
import { Tooltip } from "../primitives/Tooltip";
import { RowContextMenu } from "../contextMenus/RowContextMenu";
import { SEPARATOR, type ContextEntry } from "../contextMenus/contextItems";
import { stampThumbnail } from "../stamps/stampThumb";
import { pickRecentStamp, pickRecentTile, recentStampLabel } from "./recentTiles";

/** Height of a strip item (CSS px). */
const ITEM = 26;
/** Widest a stamp thumbnail gets (wide stamps shrink to fit). */
const STAMP_MAX_W = ITEM * 3;

/** The item can still be drawn (its tileset, or one of the stamp's tilesets, exists). */
function usable(doc: MapDocument, item: RecentItem): boolean {
  return isRecentStamp(item) ? item.stamp.palette.some((p) => doc.getTileset(p.tilesetId)) : !!doc.getTileset(item.tilesetId);
}

/**
 * Slim strip under the canvas: the most recently used tiles and multi-tile
 * stamps (newest left). Click one to paint with it again; hover for its
 * tileset · id (or the stamp's name, or its anchor tileset · size @ id). Empty: a quiet one-line hint.
 */
export function RecentTilesStrip() {
  const recent = useEditorStore((s) => s.recentTiles);
  const selection = useEditorStore((s) => s.selection);
  const stamp = useEditorStore((s) => s.stamp);
  const store = useEditorStore((s) => s.project?.store);
  useStructureVersion(store);
  const doc = store?.document;
  const items = doc ? recent.filter((item) => usable(doc, item)) : [];

  return (
    <div
      role="toolbar"
      aria-label={t("recent.title")}
      data-recent-strip
      className="flex h-recentstrip shrink-0 items-center gap-2.5 border-t border-line bg-panel pr-2 pl-3"
    >
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted">
        <Icon name="history" size={13} className="text-faint" />
        {t("recent.title")}
      </span>
      {items.length === 0 ? (
        <span className="truncate text-xs text-faint" data-recent-empty>
          {t("recent.empty")}
        </span>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
          {items.map((item) => {
            if (isRecentStamp(item)) {
              const on = stamp === item.stamp;
              const label = recentStampLabel(doc, item.stamp);
              return (
                <Item key={recentKey(item)} itemKey={recentKey(item)} label={label} on={on} data={`stamp:${item.key}`} onClick={() => pickRecentStamp(item.stamp)}>
                  <StampMini doc={doc!} clip={item.stamp} />
                </Item>
              );
            }
            const tileset = doc!.getTileset(item.tilesetId)!;
            const on = !stamp && selection?.tilesetId === item.tilesetId && selection.tileId === item.tileId;
            return (
              <Item
                key={recentKey(item)}
                itemKey={recentKey(item)}
                label={t("recent.tile", { id: item.tileId, tileset: tileset.name })}
                on={on}
                data={`${item.tilesetId}:${item.tileId}`}
                onClick={() => pickRecentTile(item)}
              >
                <TileSwatch tileset={tileset} tileId={item.tileId} size={ITEM} className="block rounded-xs" />
              </Item>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Right-click on a strip item: take it off the list, or clear the list. */
function recentItemMenu(key: string): ContextEntry[] {
  return [
    {
      type: "item",
      id: "remove",
      label: t("contextMenu.recentRemove"),
      icon: "x",
      run: () => useEditorStore.setState((s) => ({ recentTiles: s.recentTiles.filter((item) => recentKey(item) !== key) })),
    },
    SEPARATOR,
    { type: "item", id: "clear", label: t("contextMenu.recentClear"), icon: "trash", danger: true, run: () => useEditorStore.setState({ recentTiles: [] }) },
  ];
}

function Item({
  label,
  on,
  data,
  itemKey,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  data: string;
  itemKey: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <RowContextMenu items={() => recentItemMenu(itemKey)} render={<span className="flex shrink-0" />}>
      <ItemButton label={label} on={on} data={data} onClick={onClick}>
        {children}
      </ItemButton>
    </RowContextMenu>
  );
}

function ItemButton({ label, on, data, onClick, children }: { label: string; on: boolean; data: string; onClick(): void; children: ReactNode }) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        aria-label={label}
        aria-pressed={on}
        data-recent-tile={data}
        onClick={onClick}
        className={`shrink-0 rounded-sm p-px transition-shadow ${
          on ? "shadow-[0_0_0_2px_var(--color-accent)]" : "hover:shadow-[0_0_0_1px_var(--color-line-strong)]"
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** A stamp's tile layers composited into a strip-sized thumbnail (crisp, checkerboard behind). */
function StampMini({ doc, clip }: { doc: MapDocument; clip: TileClip }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const images = useImageVersion();
  const { tileWidth, tileHeight } = doc.map;
  const aspect = (clip.width * tileWidth) / Math.max(1, clip.height * tileHeight);
  const cssW = Math.round(Math.min(STAMP_MAX_W, Math.max(ITEM, ITEM * aspect)));

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const boxW = Math.round(cssW * dpr);
    const boxH = Math.round(ITEM * dpr);
    canvas.width = boxW;
    canvas.height = boxH;
    const thumb = stampThumbnail(
      clip,
      `recent:${images}:${boxW}x${boxH}:${tileWidth}x${tileHeight}`,
      { width: boxW, height: boxH },
      tileWidth,
      tileHeight,
      (id) => doc.getTileset(id),
      (id) => getTilesetImage(id)?.bitmap,
    );
    ctx.clearRect(0, 0, boxW, boxH);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(thumb, Math.floor((boxW - thumb.width) / 2), Math.floor((boxH - thumb.height) / 2));
  }, [clip, doc, images, cssW, tileWidth, tileHeight]);

  return (
    <span className="relative block">
      <canvas ref={ref} aria-hidden style={{ width: cssW, height: ITEM }} className="checker block rounded-xs pixelated" />
      {/* Marks a stamp among single tiles. */}
      <span aria-hidden className="absolute right-0 bottom-0 grid size-[11px] place-items-center rounded-tl-xs rounded-br-xs bg-panel/90 text-muted">
        <Icon name="stamp" size={9} strokeWidth={2.25} />
      </span>
    </span>
  );
}
