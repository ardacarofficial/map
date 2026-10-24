import { lineCells } from "@smap/core";
import { AGENT_LIMITS, type Point, type Rect } from "./contracts";
import { budget } from "./validation";

export function rectanglePoints(r: Rect, outline = 0): Point[] {
  // Uniform rectangles may cover the whole map; the edit's total cell budget still applies.
  budget(r.width * r.height, AGENT_LIMITS.mapArea);
  const out: Point[] = [];
  for (let y = r.y; y < r.y + r.height; y++)
    for (let x = r.x; x < r.x + r.width; x++) {
      if (
        !outline ||
        x < r.x + outline ||
        y < r.y + outline ||
        x >= r.x + r.width - outline ||
        y >= r.y + r.height - outline
      )
        out.push({ x, y });
    }
  return out;
}
export function linePoints(from: Point, to: Point, width = 1): Point[] {
  const points = new Map<string, Point>();
  const offsets: Point[] = [],
    low = -Math.floor((width - 1) / 2);
  for (let y = low; y < low + width; y++)
    for (let x = low; x < low + width; x++) offsets.push({ x, y });
  for (const p of lineCells(from.x, from.y, to.x, to.y))
    for (const offset of offsets) {
      const q = { x: p.x + offset.x, y: p.y + offset.y };
      points.set(`${q.x},${q.y}`, q);
      budget(points.size);
    }
  return [...points.values()];
}
export function pathPoints(points: readonly Point[], width: number): Point[] {
  const output = new Map<string, Point>();
  for (let i = 0; i < points.length; i++)
    for (const p of linePoints(
      points[Math.max(0, i - 1)]!,
      points[i]!,
      width,
    )) {
      output.set(`${p.x},${p.y}`, p);
      budget(output.size);
    }
  return [...output.values()];
}
