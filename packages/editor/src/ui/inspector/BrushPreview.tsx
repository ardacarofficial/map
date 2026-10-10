import type { MapDocument, TileClip } from "@smap/core";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { compositeOps } from "../../export/pngComposite";
import { replayOps } from "../../export/pngRender";
import { getTilesetImage, onTilesetImage } from "../../state/tilesetImages";
import { stampDrawList, thumbScale } from "../stamps/stampThumb";

let imageVersion = 0;
const subscribeImages = (notify: () => void) =>
  onTilesetImage(() => {
    imageVersion++;
    notify();
  });

/**
 * The clip on the brush (stamp, pasted selection, multi-tile pick) drawn
 * crisply into a `width × height` box, tile layers composited as on export.
 */
export function BrushPreview({ clip, doc, width, height }: { clip: TileClip; doc: MapDocument; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const images = useSyncExternalStore(subscribeImages, () => imageVersion);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const { tileWidth, tileHeight } = doc.map;
    const list = stampDrawList(clip, tileWidth, tileHeight, (id) => doc.getTileset(id));
    const pad = 6 * dpr;
    const scale = thumbScale(list.width, list.height, canvas.width - pad * 2, canvas.height - pad * 2, 8);
    const w = Math.max(1, Math.round(list.width * scale));
    const h = Math.max(1, Math.round(list.height * scale));
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const offCtx = off.getContext("2d");
    if (!offCtx) return;
    replayOps(offCtx, compositeOps(list, scale), (id) => getTilesetImage(id)?.bitmap);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, Math.floor((canvas.width - w) / 2), Math.floor((canvas.height - h) / 2));
  }, [clip, doc, width, height, images]);

  return <canvas ref={ref} aria-hidden style={{ width, height }} className="checker shrink-0 rounded-md border border-line pixelated" />;
}
