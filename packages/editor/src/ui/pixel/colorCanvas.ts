import { hsvToRgb, type Hsva } from '@smap/core';
export type ColorControl = 'square' | 'hue' | 'alpha';
/** Only functional colour controls draw gradients. Chrome always reads design tokens. */
export function drawColorControl(canvas: HTMLCanvasElement, control: ColorControl, hsv: Hsva): void {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const { width: w, height: h } = canvas, style = getComputedStyle(canvas);
  const checker = ['--color-checker-a', '--color-checker-b'].map(token => style.getPropertyValue(token).trim());
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = hsvToRgb(control === 'square' ? { h: hsv.h, s: x / (w - 1), v: 1 - y / (h - 1), a: 255 } : control === 'hue' ? { h: x / (w - 1) * 359, s: 1, v: 1, a: 255 } : { ...hsv, a: 255 });
    const i = (y * w + x) * 4;
    const base = checker[(Math.floor(x / 8) + Math.floor(y / 8)) % 2] ?? '';
    const alpha = control === 'alpha' ? x / (w - 1) : 1;
    image.data[i] = Math.round(c.r * alpha + (parseInt(base.slice(1, 3), 16) || 0) * (1 - alpha));
    image.data[i + 1] = Math.round(c.g * alpha + (parseInt(base.slice(3, 5), 16) || 0) * (1 - alpha));
    image.data[i + 2] = Math.round(c.b * alpha + (parseInt(base.slice(5, 7), 16) || 0) * (1 - alpha)); image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const x = control === 'square' ? hsv.s * (w - 1) : control === 'hue' ? Math.min(359, hsv.h) / 359 * (w - 1) : hsv.a / 255 * (w - 1);
  const y = (1 - hsv.v) * (h - 1);
  for (const [token, width] of [['--color-canvas', 3], ['--color-title', 1]] as const) {
    ctx.strokeStyle = style.getPropertyValue(token).trim(); ctx.lineWidth = width;
    ctx.beginPath();
    if (control === 'square') ctx.arc(x, y, 4, 0, Math.PI * 2);
    else { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    ctx.stroke();
  }
}
