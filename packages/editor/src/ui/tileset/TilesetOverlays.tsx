/**
 * What the tileset grid draws: the tiles (1 tile px = 1 canvas px, CSS
 * scales), the marks canvas (empty / solid tiles), the selection outline,
 * the hover label and the terrain block ghost.
 */
import { terrainTemplateInfo, tileRect, type TerrainTemplate, type Tileset } from "@smap/core";
import { useMemo, type ReactNode } from "react";

import { t } from "../../i18n";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { templateGlyphs } from "../terrain/templateGlyph";
import { cellOf, outlinePath, type Cell, type GridSize } from "./selectionModel";

type TileCell = Cell;

/** `#rrggbb` CSS variable → `[r, g, b]`. */
function cssColor(name: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  if (!m) return fallback;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Largest overlay canvas side in device px (very large tilesets at high zoom draw the marks at lower resolution). */
const MAX_OVERLAY_PX = 8192;

/**
 * Marks on top of the tileset image: fully transparent tiles dimmed, solid
 * tiles. In "Katı işaretle" mode solid tiles are tinted, hatched and
 * outlined; otherwise a small corner mark keeps the state visible without
 * getting in the way.
 */
export function drawMarks(
  canvas: HTMLCanvasElement,
  tileset: Tileset,
  empty: ReadonlySet<number>,
  cellW: number,
  cellH: number,
  cssW: number,
  cssH: number,
  marking: boolean,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const solid = tileset.solidTiles ?? [];
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_OVERLAY_PX / Math.max(1, cssW), MAX_OVERLAY_PX / Math.max(1, cssH));
  const nothing = solid.length === 0 && empty.size === 0;
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
    const [r, g, b] = cssColor("--color-bg", [20, 20, 22]);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.62)`;
    for (const id of empty) {
      const { x0, y0, x1, y1 } = box(id);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  if (solid.length === 0) return;
  const [r, g, b] = cssColor("--color-collision-solid", [255, 84, 104]);
  const rgba = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;
  if (!marking && Math.min(cellW, cellH) < 10) return;
  for (const id of solid) {
    const { x0, y0, x1, y1 } = box(id);
    const w = x1 - x0;
    const h = y1 - y0;
    if (marking) {
      ctx.fillStyle = rgba(0.24);
      ctx.fillRect(x0, y0, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, w, h);
      ctx.clip();
      ctx.strokeStyle = rgba(0.75);
      ctx.lineWidth = Math.max(1, Math.round(dpr));
      const step = Math.max(4, Math.round(6 * dpr));
      ctx.beginPath();
      for (let d = -h; d < w; d += step) {
        ctx.moveTo(x0 + d, y1);
        ctx.lineTo(x0 + d + h, y0);
      }
      ctx.stroke();
      ctx.restore();
      const line = Math.max(1, Math.round(1.5 * dpr));
      ctx.strokeStyle = rgba(1);
      ctx.lineWidth = line;
      ctx.strokeRect(x0 + line / 2, y0 + line / 2, w - line, h - line);
    } else {
      const s = Math.round(Math.max(4, Math.min(cellW, cellH) * 0.26) * dpr);
      ctx.beginPath();
      ctx.moveTo(x1 - s, y0);
      ctx.lineTo(x1, y0);
      ctx.lineTo(x1, y0 + s);
      ctx.closePath();
      ctx.fillStyle = rgba(1);
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
      ctx.lineWidth = Math.max(1, Math.round(dpr));
      ctx.beginPath();
      ctx.moveTo(x1 - s, y0);
      ctx.lineTo(x1, y0 + s);
      ctx.stroke();
    }
  }
}

/** The tileset's tiles side by side at 1 tile pixel = 1 canvas pixel (margin and spacing cut away); CSS scales it up crisply. */
export function drawTiles(canvas: HTMLCanvasElement, tileset: Tileset, bitmap: ImageBitmap): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { tileWidth: tw, tileHeight: th, columns, rows } = tileset;
  canvas.width = Math.max(1, columns * tw);
  canvas.height = Math.max(1, rows * th);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (tileset.margin === 0 && tileset.spacing === 0) {
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
}) {
  const skipEmpty = ids.length > 1;
  const fill = useMemo(() => {
    const parts: string[] = [];
    for (const id of ids) {
      if (skipEmpty && empty.has(id)) continue;
      const { col, row } = cellOf(tileset, id);
      const x0 = Math.round(col * cellW);
      const y0 = Math.round(row * cellH);
      parts.push(`M${x0} ${y0}H${Math.round((col + 1) * cellW)}V${Math.round((row + 1) * cellH)}H${x0}Z`);
    }
    return parts.join("");
  }, [ids, empty, skipEmpty, tileset, cellW, cellH]);
  const outline = useMemo(() => outlinePath(tileset, ids, cellW, cellH), [tileset, ids, cellW, cellH]);
  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      className="pointer-events-none absolute inset-0 overflow-visible"
      shapeRendering="crispEdges"
      data-selected-tiles={ids.join(",")}
    >
      <path d={fill} fill="var(--color-accent)" fillOpacity={live ? 0.28 : 0.22} />
      <path d={outline} fill="none" stroke="var(--color-bg)" strokeWidth={4} strokeLinecap="square" strokeOpacity={0.7} />
      <path d={outline} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinecap="square" strokeDasharray={live ? "4 3" : undefined} />
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
      className="pointer-events-none absolute z-10 rounded-sm border border-line bg-raised/95 px-1.5 font-mono text-2xs leading-4 whitespace-nowrap text-text shadow-popup tabular"
      style={{ left, top: flipBottom ? cell.row * cellH + 2 : top }}
    >
      {text}
    </div>
  );
}

/** Strip above the tileset while a mode is on: what to do, and "Bitti". */
export function ModeBar({
  icon,
  tone,
  onDone,
  children,
}: {
  icon: "bricks" | "terrain" | "dice";
  tone: "solid" | "terrain" | "random";
  onDone(): void;
  children: ReactNode;
}) {
  return (
    <div className="mx-2 mb-1 flex shrink-0 items-center gap-2 rounded-md border border-line bg-raised py-1 pr-1 pl-2">
      <Icon
        name={icon}
        size={14}
        className={`shrink-0 ${tone === "solid" ? "text-collision-solid" : tone === "random" ? "text-accent" : "text-terrain-tint"}`}
      />
      {children}
      <Button variant="ghost" className="h-6 shrink-0 px-2 text-sm" onClick={onDone}>
        {t("tileset.done")}
      </Button>
    </div>
  );
}

/** Block-sized outline that follows the cursor; each cell shows its template glyph. */
export function BlockGhost({
  template,
  left,
  top,
  cellW,
  cellH,
  columns,
  rows,
  invalid,
  pinned,
}: {
  template: TerrainTemplate;
  left: number;
  top: number;
  cellW: number;
  cellH: number;
  columns: number;
  rows: number;
  invalid: boolean;
  pinned: boolean;
}) {
  const glyphs = useMemo(() => templateGlyphs(terrainTemplateInfo(template)), [template]);
  const width = columns * cellW;
  const height = rows * cellH;
  const unit = Math.floor(Math.min(cellW, cellH) * 0.42 / 3);
  return (
    <div
      aria-hidden
      data-terrain-ghost
      className={`pointer-events-none absolute ${invalid ? "bg-danger/15 outline-danger" : "bg-terrain-tint/10 outline-terrain-tint"} ${
        pinned ? "" : "transition-[left,top] duration-75"
      }`}
      style={{ left, top, width, height, outlineWidth: 2, outlineStyle: pinned ? "solid" : "dashed", outlineOffset: -1 }}
    >
      {unit >= 2 && !invalid && (
        <svg width={width} height={height} className="absolute inset-0" shapeRendering="crispEdges">
          {glyphs.map((glyph, s) => {
            const size = unit * 3;
            const x0 = Math.round((s % columns) * cellW + (cellW - size) / 2);
            const y0 = Math.round(Math.floor(s / columns) * cellH + (cellH - size) / 2);
            if (!glyph) return null;
            return (
              <g key={s}>
                <rect x={x0 - 1} y={y0 - 1} width={size + 2} height={size + 2} fill="var(--color-overlay)" />
                {glyph.map((on, i) =>
                  on ? (
                    <rect
                      key={i}
                      x={x0 + (i % 3) * unit}
                      y={y0 + Math.floor(i / 3) * unit}
                      width={unit}
                      height={unit}
                      fill="var(--color-terrain-tint)"
                    />
                  ) : null,
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
