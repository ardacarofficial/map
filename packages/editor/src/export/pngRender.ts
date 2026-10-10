/** PNG export, the browser half: replays `compositeOps` on a 2D canvas and encodes a PNG. */
import { layerDrawList, type ExportLayerOptions, type MapDocument } from "@smap/core";

import { compositeOps, opsTilesets, pngFits, pngSize, type CanvasOp } from "./pngComposite";

/** Minimal 2D context surface the replay needs (OffscreenCanvas or HTMLCanvasElement). */
export interface Replay2D {
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/** Draws `ops` onto `ctx`; ops whose image is missing are skipped. */
export function replayOps(ctx: Replay2D, ops: readonly CanvasOp[], image: (tilesetId: string) => CanvasImageSource | undefined): void {
  ctx.imageSmoothingEnabled = false;
  for (const op of ops) {
    if (op.kind === "alpha") {
      ctx.globalAlpha = op.alpha;
      continue;
    }
    const source = image(op.tilesetId);
    if (!source) continue;
    ctx.setTransform(...op.transform);
    ctx.drawImage(source, op.sx, op.sy, op.sw, op.sh, 0, 0, op.dw, op.dh);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
}

export class PngTooLargeError extends Error {
  constructor() {
    super("PNG too large");
    this.name = "PngTooLargeError";
  }
}

export interface RenderedPng {
  blob: Blob;
  width: number;
  height: number;
  /** Tilesets whose image was not loaded (their tiles are missing from the PNG). */
  missing: string[];
}

/** Composites the whole map (visible tile layers, only `options.layers` when given) into one PNG. */
export async function renderMapPng(
  doc: MapDocument,
  scale: number,
  image: (tilesetId: string) => ImageBitmap | undefined,
  options: ExportLayerOptions = {},
): Promise<RenderedPng> {
  const list = layerDrawList(doc, options);
  if (!pngFits(list.width, list.height, scale)) throw new PngTooLargeError();
  const { width, height } = pngSize(list.width, list.height, scale);
  const ops = compositeOps(list, scale);
  const missing = [...opsTilesets(ops)].filter((id) => !image(id));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PngTooLargeError();
  replayOps(ctx, ops, image);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return { blob, width, height, missing };
}
