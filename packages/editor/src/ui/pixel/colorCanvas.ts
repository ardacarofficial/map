import { hsvToRgb, type Hsva } from '@smap/core';
export type ColorControl = 'square' | 'hue' | 'alpha';
const rgb = (hsv: Hsva) => { const { r, g, b } = hsvToRgb(hsv); return `rgb(${r} ${g} ${b})`; };
/** Only functional colour controls draw gradients. Chrome always reads design tokens. */
export function drawColorControl(canvas: HTMLCanvasElement, control: ColorControl, hsv: Hsva): void {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const { width: w, height: h } = canvas, style = getComputedStyle(canvas);
  if (control === 'square') {
    ctx.fillStyle = rgb({ ...hsv, s: 1, v: 1, a: 255 }); ctx.fillRect(0, 0, w, h);
    const saturation = ctx.createLinearGradient(0, 0, w, 0);
    saturation.addColorStop(0, 'rgba(255,255,255,1)'); saturation.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = saturation; ctx.fillRect(0, 0, w, h);
    const value = ctx.createLinearGradient(0, 0, 0, h);
    value.addColorStop(0, 'rgba(0,0,0,0)'); value.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = value; ctx.fillRect(0, 0, w, h);
  } else if (control === 'hue') {
    const hue = ctx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 6; i++) hue.addColorStop(i / 6, rgb({ h: i / 6 * 359, s: 1, v: 1, a: 255 }));
    ctx.fillStyle = hue; ctx.fillRect(0, 0, w, h);
  } else {
    const checker = ['--color-checker-a', '--color-checker-b'].map(token => style.getPropertyValue(token).trim());
    for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { ctx.fillStyle = checker[(x / 8 + y / 8) % 2]!; ctx.fillRect(x, y, 8, 8); }
    const { r, g, b } = hsvToRgb(hsv), alpha = ctx.createLinearGradient(0, 0, w, 0);
    alpha.addColorStop(0, `rgba(${r},${g},${b},0)`); alpha.addColorStop(1, `rgba(${r},${g},${b},1)`);
    ctx.fillStyle = alpha; ctx.fillRect(0, 0, w, h);
  }
  // Keep the whole cursor visible at the extrema, including pure black/white.
  const inset = control === 'square' ? 5 : 2;
  const position = control === 'square' ? hsv.s : control === 'hue' ? Math.min(359, hsv.h) / 359 : hsv.a / 255;
  const x = Math.max(inset, Math.min(w - inset, position * (w - 1))), y = Math.max(inset, Math.min(h - inset, (1 - hsv.v) * (h - 1)));
  for (const [token, width] of [['--color-canvas', 4], ['--color-title', 2]] as const) {
    ctx.strokeStyle = style.getPropertyValue(token).trim(); ctx.lineWidth = width;
    ctx.beginPath();
    if (control === 'square') ctx.arc(x, y, 4, 0, Math.PI * 2);
    else ctx.rect(x - 1, 1, 2, h - 2);
    ctx.stroke();
  }
}
