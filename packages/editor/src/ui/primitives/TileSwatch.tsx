import { tileRect, type Tileset } from "@smap/core";
import { useEffect, useRef } from "react";

import { useTilesetImage } from "../hooks";

/** One tile drawn crisply into a `size`×`size` px box (checkerboard behind). */
export function TileSwatch({
  tileset,
  tileId,
  size,
  className = "",
}: {
  tileset: Tileset;
  tileId: number;
  size: number;
  className?: string;
}) {
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
    ctx.imageSmoothingEnabled = false;
    const r = tileRect(tileset, tileId);
    const scale = Math.min(canvas.width / r.width, canvas.height / r.height);
    const w = r.width * scale;
    const h = r.height * scale;
    ctx.drawImage(image.bitmap, r.x, r.y, r.width, r.height, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }, [image, tileset, tileId, size]);

  return <canvas ref={ref} aria-hidden style={{ width: size, height: size }} className={`checker shrink-0 pixelated ${className}`} />;
}
