/** Drawing a palette's slots into a canvas (tiles from their tilesets' images, flips applied). */
import { FLIP_D, FLIP_H, FLIP_V, tileRect, type Tileset } from "@smap/core";

import { getTilesetImage } from "../../state/tilesetImages";
import { cssColor } from "../tileset/cssColor";
import type { PaletteData } from "./paletteModel";

/**
 * Draws `palette` (`rows` rows) at `slotW × slotH` canvas px per slot.
 * Tiles of another size are fitted into the slot. Missing tilesets /
 * images leave the slot empty (it then shows a red cross).
 */
export function drawPalette(
  canvas: HTMLCanvasElement,
  palette: PaletteData,
  rows: number,
  slotW: number,
  slotH: number,
  getTileset: (id: string) => Tileset | undefined,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = Math.max(1, palette.columns * slotW);
  canvas.height = Math.max(1, rows * slotH);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const c of palette.cells) {
    const x = c.x * slotW;
    const y = c.y * slotH;
    const tileset = getTileset(c.tilesetId);
    const image = tileset ? getTilesetImage(tileset.id) : undefined;
    if (!tileset || !image || c.tileId >= tileset.columns * tileset.rows) {
      ctx.strokeStyle = cssColor("--color-danger");
      ctx.lineWidth = Math.max(1, slotW / 16);
      ctx.beginPath();
      ctx.moveTo(x + slotW * 0.3, y + slotH * 0.3);
      ctx.lineTo(x + slotW * 0.7, y + slotH * 0.7);
      ctx.moveTo(x + slotW * 0.7, y + slotH * 0.3);
      ctx.lineTo(x + slotW * 0.3, y + slotH * 0.7);
      ctx.stroke();
      continue;
    }
    const r = tileRect(tileset, c.tileId);
    const flags = c.flags ?? 0;
    const d = (flags & FLIP_D) !== 0;
    const sw = d ? r.height : r.width;
    const sh = d ? r.width : r.height;
    const scale = Math.min(slotW / sw, slotH / sh);
    const w = r.width * scale;
    const h = r.height * scale;
    ctx.save();
    ctx.translate(x + slotW / 2, y + slotH / 2);
    ctx.scale(flags & FLIP_H ? -1 : 1, flags & FLIP_V ? -1 : 1);
    if (d) ctx.transform(0, 1, 1, 0, 0, 0);
    ctx.drawImage(image.bitmap, r.x, r.y, r.width, r.height, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}
