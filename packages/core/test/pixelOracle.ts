/* Test-only CPU compositor. It consumes the public export draw list, never migration data. */
// eslint-disable-next-line no-restricted-imports -- test-only frozen fixture oracle
import { createHash } from "node:crypto";
import { layerDrawList, type MapDocument } from "../src";
import type { RgbaImage } from "../src";

export function composite(doc: MapDocument, images: ReadonlyMap<string, RgbaImage>): Uint8Array {
  const list = layerDrawList(doc), out = new Uint8Array(list.width * list.height * 4);
  for (const layer of list.layers) for (const item of layer.items) {
    const image = images.get(item.tileset.id)!;
    for (let sy = 0; sy < item.src.height; sy++) for (let sx = 0; sx < item.src.width; sx++) {
      let x = item.flipD ? sy : sx, y = item.flipD ? sx : sy;
      if (item.flipH) x = item.dest.width - 1 - x;
      if (item.flipV) y = item.dest.height - 1 - y;
      x += item.dest.x; y += item.dest.y;
      if (x < 0 || y < 0 || x >= list.width || y >= list.height) continue;
      const from = ((item.src.y + sy) * image.width + item.src.x + sx) * 4, to = (y * list.width + x) * 4;
      const a = image.data[from + 3]! / 255 * layer.opacity, old = out[to + 3]! / 255, alpha = a + old * (1 - a);
      for (let c = 0; c < 3; c++) out[to + c] = alpha ? Math.round((image.data[from + c]! * a + out[to + c]! * old * (1 - a)) / alpha) : 0;
      out[to + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}
export function pixelHash(doc: MapDocument, images: ReadonlyMap<string, RgbaImage>): string {
  return createHash("sha256").update(composite(doc, images)).digest("hex");
}
