/** Tile thumbnail: tileset, tileId, size and canvas props; checker background, crisp pixels. */
import { tileRect, type Tileset } from "@smap/core";
import { useEffect, useImperativeHandle, useRef, type ComponentPropsWithRef } from "react";

import { useTilesetImage } from "../hooks";

/** One tile drawn crisply into a `size`×`size` px box (checkerboard behind). */
export function TileSwatch({
  tileset,
  tileId,
  size,
  className = "",
  ref: forwardedRef,
  style,
  ...rest
}: ComponentPropsWithRef<"canvas"> & {
  tileset: Tileset;
  tileId: number;
  size: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current!);
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

  return <canvas {...rest} ref={ref} aria-hidden style={{ width: size, height: size, ...style }} className={`checker shrink-0 rounded-xs pixelated ${className}`} />;
}
