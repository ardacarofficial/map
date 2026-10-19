
import { tileRect, type Tileset } from "@smap/core";
import { useMemo } from "react";

import { cssColor } from "./cssColor";
import { cellOf, outlinePath, type Cell, type GridSize } from "./selectionModel";

type TileCell = Cell;

/** Theme tokens used by the drawing canvas are #rrggbb. */
function colorChannels(name: string): [number, number, number] {
  const n = Number.parseInt(cssColor(name).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Largest overlay canvas side in device px (very large tilesets at high zoom draw the marks at lower resolution). */
const MAX_OVERLAY_PX = 8192;

export function drawMarks(
  canvas: HTMLCanvasElement,
  tileset: Tileset,
  empty: ReadonlySet<number>,
  cellW: number,
  cellH: number,
  cssW: number,
  cssH: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_OVERLAY_PX / Math.max(1, cssW), MAX_OVERLAY_PX / Math.max(1, cssH));
  const nothing = empty.size === 0;
  canvas.width = nothing ? 1 : Math.max(1, Math.round(cssW * dpr));
  canvas.height = nothing ? 1 : Math.max(1, Math.round(cssH * dpr));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (nothing) return;
  const cw = cellW * dpr;
  const ch = cellH * dpr;
  const box = (id: number) => {
    const col = id % tileset.columns;
    const row = Math.floor(id / tileset.columns);
    const x0 = Math.round(col * cw);
    const y0 = Math.round(row * ch);
    return { x0, y0, x1: Math.round((col + 1) * cw), y1: Math.round((row + 1) * ch) };
  };
  if (empty.size > 0) {
    const [r, g, b] = colorChannels("--color-bg");
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.62)`;
    for (const id of empty) {
      const { x0, y0, x1, y1 } = box(id);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
}

/** The tileset's tiles side by side at 1 tile pixel = 1 canvas pixel (margin and spacing cut away); CSS scales it up crisply. */
export function drawTiles(canvas: HTMLCanvasElement, tileset: Tileset, bitmap: ImageBitmap, sourcePixels = false): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { tileWidth: tw, tileHeight: th, columns, rows } = tileset;
  canvas.width = Math.max(1, sourcePixels ? bitmap.width : columns * tw);
  canvas.height = Math.max(1, sourcePixels ? bitmap.height : rows * th);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (sourcePixels || (tileset.margin === 0 && tileset.spacing === 0)) {
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return;
  }
  for (let id = 0; id < columns * rows; id++) {
    const r = tileRect(tileset, id);
    ctx.drawImage(bitmap, r.x, r.y, r.width, r.height, (id % columns) * tw, Math.floor(id / columns) * th, tw, th);
  }
}

/**
 * Selected cells: a translucent accent fill and an accent outline around
 * the selection's edge (holes of a Ctrl selection show). Transparent tiles
 * inside a selection are left unfilled: they are not part of the stamp.
 */
export function SelectionOverlay({
  tileset,
  ids,
  empty,
  cellW,
  cellH,
  width,
  height,
  live,
  gapX = 0,
  gapY = 0,
}: {
  /** The grid (a tileset, or a palette's columns × rows). */
  tileset: GridSize;
  ids: readonly number[];
  empty: ReadonlySet<number>;
  cellW: number;
  cellH: number;
  width: number;
  height: number;
  live: boolean;
  gapX?: number;
  gapY?: number;
}) {
  const skipEmpty = ids.length > 1;
  const fill = useMemo(() => {
    const parts: string[] = [];
    for (const id of ids) {
      if (skipEmpty && empty.has(id)) continue;
      const { col, row } = cellOf(tileset, id);
      const x0 = Math.round(col * cellW);
      const y0 = Math.round(row * cellH);
      parts.push(`M${x0} ${y0}H${Math.round((col + 1) * cellW - gapX)}V${Math.round((row + 1) * cellH - gapY)}H${x0}Z`);
    }
    return parts.join("");
  }, [ids, empty, skipEmpty, tileset, cellW, cellH, gapX, gapY]);
  const outline = useMemo(() => gapX || gapY ? ids.map(id => {
    const { col, row } = cellOf(tileset, id);
    return `M${col * cellW} ${row * cellH}h${cellW - gapX}v${cellH - gapY}h${-(cellW - gapX)}Z`;
  }).join("") : outlinePath(tileset, ids, cellW, cellH), [tileset, ids, cellW, cellH, gapX, gapY]);
  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      className="pointer-events-none absolute inset-0 overflow-visible"
      shapeRendering="crispEdges"
      data-selected-tiles={ids.join(",")}
    >
      <path d={fill} fill="var(--color-accent-soft)" fillOpacity={0.3} />
      <path d={outline} fill="none" stroke="var(--color-bg)" strokeWidth={3} strokeLinecap="square" strokeOpacity={0.7} />
      <path d={outline} fill="none" stroke="var(--color-accent)" strokeWidth={1} strokeLinecap="square" strokeDasharray={live ? "4 3" : undefined} />
    </svg>
  );
}

/** Small chip next to a cell: "id 12 · (4, 1)" on hover, "3 × 2" while dragging. */
export function CellLabel({
  cell,
  cellW,
  cellH,
  width,
  rows,
  text,
}: {
  cell: TileCell;
  cellW: number;
  cellH: number;
  width: number;
  rows: number;
  text: string;
}) {
  const below = cell.row === 0 || (cell.row + 1) * cellH < 22;
  const top = below ? (cell.row + 1) * cellH + 3 : cell.row * cellH - 19;
  const flipBottom = below && cell.row === rows - 1;
  const left = Math.min(Math.max(0, cell.col * cellW), Math.max(0, width - 96));
  return (
    <div
      aria-hidden
      data-tileset-cell-label
      className="pointer-events-none absolute z-10 rounded-sm border border-line-strong bg-popup px-1.5 font-mono text-2xs leading-4 whitespace-nowrap text-text tabular"
      style={{ left, top: flipBottom ? cell.row * cellH + 2 : top }}
    >
      {text}
    </div>
  );
}
