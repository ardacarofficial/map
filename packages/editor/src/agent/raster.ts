import type { Rect } from "@smap/agent";
import type { RgbaImage } from "@smap/core";
import type { Replay2D } from "../export/pngRender";

/** A bounded nearest-neighbour replay target; the shared PNG draw list owns orientation. */
export class RasterReplay implements Replay2D {
  globalAlpha = 1;
  imageSmoothingEnabled = false;
  readonly data: Uint8Array;
  #transform = [1, 0, 0, 1, 0, 0];
  constructor(readonly width: number, readonly height: number, readonly clip: Rect = { x: 0, y: 0, width, height }) { this.data = new Uint8Array(width * height * 4); }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void { this.#transform = [a, b, c, d, e, f]; }
  drawImage(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void {
    const source = image as unknown as RgbaImage;
    const [a, b, c, d, e, f] = this.#transform as [number, number, number, number, number, number];
    const det = a * d - b * c;
    if (!det) return;
    const corners = [[dx, dy], [dx + dw, dy], [dx, dy + dh], [dx + dw, dy + dh]].map(([x, y]) => [a*x!+c*y!+e,b*x!+d*y!+f]);
    const left = Math.max(0, this.clip.x, Math.floor(Math.min(...corners.map(p => p[0]!))));
    const top = Math.max(0, this.clip.y, Math.floor(Math.min(...corners.map(p => p[1]!))));
    const right = Math.min(this.width, this.clip.x + this.clip.width, Math.ceil(Math.max(...corners.map(p => p[0]!))));
    const bottom = Math.min(this.height, this.clip.y + this.clip.height, Math.ceil(Math.max(...corners.map(p => p[1]!))));
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const px = x + .5 - e, py = y + .5 - f;
      const u = (d*px-c*py)/det, v = (-b*px+a*py)/det;
      if (u < dx || v < dy || u >= dx + dw || v >= dy + dh) continue;
      const ix = Math.floor(sx+(u-dx)*sw/dw), iy = Math.floor(sy+(v-dy)*sh/dh);
      if (ix < 0 || iy < 0 || ix >= source.width || iy >= source.height) continue;
      const p = (iy * source.width + ix) * 4;
      this.blend(x, y, source.data.subarray(p, p+4), this.globalAlpha);
    }
  }
  blend(x: number, y: number, rgba: ArrayLike<number>, opacity = 1): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const p = (y*this.width+x)*4, sa = rgba[3]!/255 * opacity, da = this.data[p+3]!/255;
    const out = sa + da*(1-sa);
    if (!out) return;
    for (let c=0;c<3;c++) this.data[p+c] = Math.round((rgba[c]!*sa+this.data[p+c]!*da*(1-sa))/out);
    this.data[p+3] = Math.round(out*255);
  }
  fill(rect: Rect, rgba: readonly number[]): void {
    for (let y = Math.max(0, Math.floor(rect.y)); y < Math.min(this.height, Math.ceil(rect.y+rect.height)); y++)
      for (let x = Math.max(0, Math.floor(rect.x)); x < Math.min(this.width, Math.ceil(rect.x+rect.width)); x++) this.blend(x, y, rgba);
  }
  checker(rect: Rect): void {
    for (let y=rect.y;y<rect.y+rect.height;y++) for(let x=rect.x;x<rect.x+rect.width;x++) {
      const shade = ((Math.floor(x/8)+Math.floor(y/8))%2) ? 44 : 36;
      this.blend(x,y,[shade,shade,shade,255]);
    }
  }
  text(value: string, x: number, y: number, scale = 2): void {
    const digits = ["111101101101111","010110010010111","111001111100111","111001111001111","101101111001001","111100111001111","111100111101111","111001001001001","111101111101111","111101111001111"];
    for (const ch of value) {
      const glyph = ch === "-" ? "000000111000000" : digits[Number(ch)];
      if (glyph) for(let row=0;row<5;row++)for(let col=0;col<3;col++)if(glyph[row*3+col]==="1")this.fill({x:Math.floor(x)+col*scale,y:Math.floor(y)+row*scale,width:scale,height:scale},[215,225,228,255]);
      x += 4*scale;
    }
  }
}
