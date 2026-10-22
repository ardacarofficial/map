import type { Stamp } from "@smap/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useEditorStore } from "../../state/editorStore";
import { getTilesetImage } from "../../state/tilesetImages";
import { useImageVersion, useStructureVersion } from "../hooks";
import { stampThumbnail } from "./stampThumbnailPixels";

/**
 * A stamp's tile layers composited crisply into a box `height` CSS px tall
 * and as wide as its container (library cards, list rows, the Denetçi).
 * Flips and rotations (FLIP_D) are drawn as on export (`stampThumbnailPixels.ts`).
 */
export function StampThumb({ stamp, height, pad = 4, className = "" }: { stamp: Stamp; height: number; pad?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const store = useEditorStore((s) => s.project?.store);
  const structure = useStructureVersion(store);
  const images = useImageVersion();
  const [cssWidth, setCssWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCssWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    const doc = store?.document;
    if (!canvas || !ctx || !doc || cssWidth === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const boxW = Math.round(cssWidth * dpr);
    const boxH = Math.round(height * dpr);
    canvas.width = boxW;
    canvas.height = boxH;
    const { tileWidth, tileHeight } = doc.map;
    const inset = 2 * pad * dpr;
    const thumb = stampThumbnail(
      stamp,
      `${images}:${structure}:${boxW}x${boxH}:${pad}:${tileWidth}x${tileHeight}`,
      { width: Math.max(1, boxW - inset), height: Math.max(1, boxH - inset) },
      tileWidth,
      tileHeight,
      (id) => doc.getTileset(id),
      (id) => getTilesetImage(id)?.bitmap,
    );
    ctx.clearRect(0, 0, boxW, boxH);
    ctx.imageSmoothingEnabled = false;
    // Whole device pixels keep the thumbnail crisp.
    ctx.drawImage(thumb, Math.floor((boxW - thumb.width) / 2), Math.floor((boxH - thumb.height) / 2));
  }, [stamp, store, structure, images, cssWidth, height, pad]);

  return <canvas ref={ref} aria-hidden style={{ height }} className={`checker block w-full rounded-sm pixelated ${className}`} />;
}
