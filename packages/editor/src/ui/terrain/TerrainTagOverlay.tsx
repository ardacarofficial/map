/**
 * Terrain tags drawn over the tileset grid (⚙ Düzenle → Arazi): corner sets
 * show a coloured triangle in each tagged corner, blob sets a centre square
 * plus a small mark toward every neighbour the tile connects to. Read-only;
 * clicks are handled by the grid ("Düzelt").
 */
import { BLOB_E, BLOB_N, BLOB_NE, BLOB_NW, BLOB_S, BLOB_SE, BLOB_SW, BLOB_W, type TerrainSet, type Tileset } from "@smap/core";
import { memo } from "react";

import type { TagZone } from "./terrainModel";

/** Blob bit → 3×3 position (col, row). */
const BLOB_POS: readonly (readonly [number, number, number])[] = [
  [BLOB_NW, 0, 0],
  [BLOB_N, 1, 0],
  [BLOB_NE, 2, 0],
  [BLOB_W, 0, 1],
  [BLOB_E, 2, 1],
  [BLOB_SW, 0, 2],
  [BLOB_S, 1, 2],
  [BLOB_SE, 2, 2],
];

export const TerrainTagOverlay = memo(function TerrainTagOverlay({
  tileset,
  set,
  cellW,
  cellH,
  width,
  height,
  focusTerrain,
}: {
  tileset: Tileset;
  set: TerrainSet;
  cellW: number;
  cellH: number;
  width: number;
  height: number;
  /** Terrain drawn strongest (others fainter), or null for all equal. */
  focusTerrain: number | null;
}) {
  const color = new Map(set.terrains.map((t) => [t.id, t.color]));
  const alpha = (id: number) => (focusTerrain === null || focusTerrain === id ? 0.75 : 0.35);
  return (
    <svg aria-hidden width={width} height={height} className="pointer-events-none absolute inset-0" data-terrain-tags={set.id} shapeRendering="crispEdges">
      {set.tiles.map((tag) => {
        const col = tag.tileId % tileset.columns;
        const row = Math.floor(tag.tileId / tileset.columns);
        const x = col * cellW;
        const y = row * cellH;
        if (set.kind === "corner") {
          const c = tag.corners ?? [0, 0, 0, 0];
          const w = cellW * 0.42;
          const h = cellH * 0.42;
          const tri = [
            `${x},${y} ${x + w},${y} ${x},${y + h}`,
            `${x + cellW},${y} ${x + cellW - w},${y} ${x + cellW},${y + h}`,
            `${x + cellW},${y + cellH} ${x + cellW - w},${y + cellH} ${x + cellW},${y + cellH - h}`,
            `${x},${y + cellH} ${x + w},${y + cellH} ${x},${y + cellH - h}`,
          ];
          return (
            <g key={tag.tileId} data-tag-tile={tag.tileId}>
              {c.map((id, i) => (id === 0 ? null : <polygon key={i} points={tri[i]} fill={color.get(id) ?? "#888"} fillOpacity={alpha(id)} stroke="#0008" strokeWidth={0.5} />))}
            </g>
          );
        }
        const id = tag.terrainId ?? 0;
        const fill = color.get(id) ?? "#888";
        const u = Math.min(cellW, cellH) / 3;
        const ox = x + (cellW - 3 * u) / 2;
        const oy = y + (cellH - 3 * u) / 2;
        const inset = Math.max(1, u * 0.18);
        return (
          <g key={tag.tileId} data-tag-tile={tag.tileId} fillOpacity={alpha(id)}>
            <rect x={ox + u + inset} y={oy + u + inset} width={u - 2 * inset} height={u - 2 * inset} fill={fill} stroke="#0008" strokeWidth={0.5} />
            {BLOB_POS.map(([bit, cx, cy]) =>
              ((tag.mask ?? 0) & bit) !== 0 ? (
                <rect key={bit} x={ox + cx * u + inset * 1.6} y={oy + cy * u + inset * 1.6} width={u - 3.2 * inset} height={u - 3.2 * inset} fill={fill} />
              ) : null,
            )}
          </g>
        );
      })}
    </svg>
  );
});

/** Hover mark of a "Düzelt" click zone on tile (`col`, `row`). */
export function TagZoneHover({ zone, col, row, cellW, cellH, color }: { zone: TagZone; col: number; row: number; cellW: number; cellH: number; color: string }) {
  let left = col * cellW;
  let top = row * cellH;
  const w = zone.kind === "corner" ? cellW / 2 : cellW / 3;
  const h = zone.kind === "corner" ? cellH / 2 : cellH / 3;
  if (zone.kind === "corner") {
    if (zone.corner === 1 || zone.corner === 2) left += w;
    if (zone.corner === 2 || zone.corner === 3) top += h;
  } else {
    const pos = zone.bit === 0 ? [1, 1] : (BLOB_POS.find(([bit]) => bit === zone.bit)?.slice(1) ?? [1, 1]);
    left += pos[0]! * w;
    top += pos[1]! * h;
  }
  return (
    <div
      aria-hidden
      data-tag-zone=""
      className="pointer-events-none absolute"
      style={{ left, top, width: w, height: h, outline: `2px solid ${color}`, outlineOffset: -2, background: `${color}33` }}
    />
  );
}
