/** PX2 extension point: straight RGBA HEX, newest-first recent choices (16 max).
 * addRecent records committed choices/strokes; setters alone never flood recents.
 * Persistence is installed by appSettings through its shared settings write queue.
 */
import { create } from 'zustand';
import { formatHex, parseHex, rgbToHsv, hsvToRgb, hsvToHsl, type Hsva } from '@smap/core';
export interface PixelColorSettings { fg: string; bg: string; recent: string[] }
interface PixelColors extends PixelColorSettings {
  fgHsv: Hsva; bgHsv: Hsva;
  setHsv(target: "fg" | "bg", hsv: Hsva): void;
  setFg(hex: string): void; setBg(hex: string): void; swap(): void; reset(): void;
  addRecent(hex?: string): void; clearRecent(): void;
}
const normalized = (hex: string) => { const c = parseHex(hex); return c ? formatHex(c) : null; };
export function parsePixelColors(raw: unknown): PixelColorSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.fg !== 'string' || typeof r.bg !== 'string' || !normalized(r.fg) || !normalized(r.bg) || !Array.isArray(r.recent) || r.recent.some(c => typeof c !== 'string' || !normalized(c))) return null;
  return { fg: normalized(r.fg)!, bg: normalized(r.bg)!, recent: [...new Set((r.recent as string[]).map(c => normalized(c)!))].slice(0, 16) };
}
export const usePixelColors = create<PixelColors>()((set, get) => ({
  fg: '#000000ff', bg: '#ffffffff', recent: [],
  fgHsv: rgbToHsv(parseHex('#000')!), bgHsv: rgbToHsv(parseHex('#fff')!),
  setHsv: (target, hsv) => {
    const next = { h: hsvToHsl(hsv).h, s: Math.max(0, Math.min(1, hsv.s)), v: Math.max(0, Math.min(1, hsv.v)), a: Math.round(Math.max(0, Math.min(255, hsv.a))) };
    set(target === 'fg' ? { fg: formatHex(hsvToRgb(next)), fgHsv: next } : { bg: formatHex(hsvToRgb(next)), bgHsv: next });
  },
  setFg: hex => { const fg = normalized(hex); if (fg) set({ fg, fgHsv: rgbToHsv(parseHex(fg)!, get().fgHsv.h) }); },
  setBg: hex => { const bg = normalized(hex); if (bg) set({ bg, bgHsv: rgbToHsv(parseHex(bg)!, get().bgHsv.h) }); },
  swap: () => set(s => ({ fg: s.bg, bg: s.fg, fgHsv: s.bgHsv, bgHsv: s.fgHsv })),
  reset: () => set({ fg: '#000000ff', bg: '#ffffffff', fgHsv: rgbToHsv(parseHex('#000')!), bgHsv: rgbToHsv(parseHex('#fff')!) }),
  addRecent: (hex = get().fg) => { const color = normalized(hex); if (color) set(s => ({ recent: [color, ...s.recent.filter(c => c !== color)].slice(0, 16) })); },
  clearRecent: () => set({ recent: [] }),
}));
export function pixelColorSettings(): PixelColorSettings { const { fg, bg, recent } = usePixelColors.getState(); return { fg, bg, recent: [...recent] }; }
