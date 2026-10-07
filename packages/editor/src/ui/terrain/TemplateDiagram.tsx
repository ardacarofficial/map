import { terrainTemplateInfo, type TerrainTemplate } from "@smap/core";
import { useMemo } from "react";

import { templateGlyphs } from "./templateGlyph";

/**
 * The block shape of a template: one mini 3×3 glyph per slot, laid out like
 * the block itself, so a layout is recognizable before picking it.
 * `unit` is one glyph cell in px; slots are `3 × unit` with a `gap` between.
 */
export function TemplateDiagram({
  template,
  unit = 3,
  gap = 2,
  className,
}: {
  template: TerrainTemplate;
  unit?: number;
  gap?: number;
  className?: string;
}) {
  const info = terrainTemplateInfo(template);
  const glyphs = useMemo(() => templateGlyphs(info), [info]);
  const slot = unit * 3;
  const width = info.columns * slot + (info.columns - 1) * gap;
  const height = info.rows * slot + (info.rows - 1) * gap;
  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="crispEdges"
      className={className}
    >
      {glyphs.map((glyph, s) => {
        const x0 = (s % info.columns) * (slot + gap);
        const y0 = Math.floor(s / info.columns) * (slot + gap);
        if (!glyph) {
          return (
            <rect
              key={s}
              x={x0 + 0.5}
              y={y0 + 0.5}
              width={slot - 1}
              height={slot - 1}
              fill="none"
              stroke="var(--color-line-strong)"
              strokeDasharray="1 1"
            />
          );
        }
        return (
          <g key={s}>
            <rect x={x0} y={y0} width={slot} height={slot} fill="var(--color-line)" />
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
  );
}
