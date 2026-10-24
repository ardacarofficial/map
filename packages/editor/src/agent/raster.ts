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
  text(value: string, x: number, y: number, scale = 2, rgba: readonly number[] = [215, 225, 228, 255]): void {
    for (const ch of value) {
      const glyph = glyphFor(ch);
      if (glyph) for(let row=0;row<5;row++)for(let col=0;col<3;col++)if(glyph[row*3+col]==="1")this.fill({x:Math.floor(x)+col*scale,y:Math.floor(y)+row*scale,width:scale,height:scale},rgba);
      x += 4*scale;
    }
  }
  /** Text on a dark box so labels stay readable over artwork. */
  label(value: string, x: number, y: number, scale = 2): { width: number; height: number } {
    const width = textWidth(value, scale) + 2 * scale, height = 7 * scale;
    this.fill({ x, y, width, height }, [11, 18, 23, 200]);
    this.text(value, x + scale, y + scale, scale);
    return { width, height };
  }
  /** 1 px (or thicker) rectangle outline. */
  outline(rect: Rect, rgba: readonly number[], thickness = 1): void {
    this.fill({ x: rect.x, y: rect.y, width: rect.width, height: thickness }, rgba);
    this.fill({ x: rect.x, y: rect.y + rect.height - thickness, width: rect.width, height: thickness }, rgba);
    this.fill({ x: rect.x, y: rect.y + thickness, width: thickness, height: rect.height - 2 * thickness }, rgba);
    this.fill({ x: rect.x + rect.width - thickness, y: rect.y + thickness, width: thickness, height: rect.height - 2 * thickness }, rgba);
  }
}

/** 3×5 bitmap glyphs: digits, Latin capitals (Turkish letters fold to ASCII) and a little punctuation. */
const GLYPHS: Record<string, string> = {
  "0":"111101101101111","1":"010110010010111","2":"111001111100111","3":"111001111001111","4":"101101111001001",
  "5":"111100111001111","6":"111100111101111","7":"111001001001001","8":"111101111101111","9":"111101111001111",
  A:"010101111101101",B:"110101110101110",C:"011100100100011",D:"110101101101110",E:"111100110100111",F:"111100110100100",
  G:"011100101101011",H:"101101111101101",I:"111010010010111",J:"001001001101010",K:"101101110101101",L:"100100100100111",
  M:"101111111101101",N:"110101101101101",O:"010101101101010",P:"110101110100100",Q:"010101101111011",R:"110101110101101",
  S:"011100010001110",T:"111010010010010",U:"101101101101111",V:"101101101101010",W:"101101111111101",X:"101101010101101",
  Y:"101101010010010",Z:"111001010100111",
  "-":"000000111000000",".":"000000000000010",",":"000000000010100",":":"000010000010000","/":"001001010100100",
  "(":"010100100100010",")":"010001001001010","#":"101111101111101","+":"000010111010000","_":"000000000000111",
  "×":"000101010101000","x":"000101010101000","→":"000010111010000","!":"010010010000010","?":"110001010000010",
};
const FOLD: Record<string, string> = { Ç:"C", Ğ:"G", İ:"I", I:"I", Ö:"O", Ş:"S", Ü:"U", ç:"C", ğ:"G", ı:"I", ö:"O", ş:"S", ü:"U" };
export function glyphFor(ch: string): string | undefined {
  if (ch === "x" || ch === "×") return GLYPHS[ch];
  const folded = FOLD[ch] ?? ch.toLocaleUpperCase("en");
  return GLYPHS[folded] ?? GLYPHS[folded.normalize("NFD")[0] ?? ""];
}
export const textWidth = (value: string, scale = 2): number => Math.max(0, [...value].length * 4 * scale - scale);
