/** PX2 extension point: straight RGBA HEX, newest-first recent choices (24 max).
 * addRecent records committed choices/strokes; setters alone never flood recents.
 * Persistence is installed by appSettings through its shared settings write queue.
 */
import { create } from 'zustand';
import { formatHex, parseHex } from '@smap/core';
export interface PixelColorSettings { fg: string; bg: string; recent: string[] }
interface PixelColors extends PixelColorSettings {
  setFg(hex: string): void; setBg(hex: string): void; swap(): void; reset(): void;
  addRecent(hex?: string): void; clearRecent(): void;
}
const normalized = (hex: string) => { const c = parseHex(hex); return c ? formatHex(c) : null; };
export function parsePixelColors(raw: unknown): PixelColorSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.fg !== 'string' || typeof r.bg !== 'string' || !normalized(r.fg) || !normalized(r.bg) || !Array.isArray(r.recent) || r.recent.some(c => typeof c !== 'string' || !normalized(c))) return null;
  return { fg: normalized(r.fg)!, bg: normalized(r.bg)!, recent: [...new Set((r.recent as string[]).map(c => normalized(c)!))].slice(0, 24) };
}
export const usePixelColors = create<PixelColors>()((set, get) => ({
  fg: '#000000ff', bg: '#ffffffff', recent: [],
  setFg: hex => { const fg = normalized(hex); if (fg) set({ fg }); },
  setBg: hex => { const bg = normalized(hex); if (bg) set({ bg }); },
  swap: () => set(s => ({ fg: s.bg, bg: s.fg })),
  reset: () => set({ fg: '#000000ff', bg: '#ffffffff' }),
  addRecent: (hex = get().fg) => { const color = normalized(hex); if (color) set(s => ({ recent: [color, ...s.recent.filter(c => c !== color)].slice(0, 24) })); },
  clearRecent: () => set({ recent: [] }),
}));
export function pixelColorSettings(): PixelColorSettings { const { fg, bg, recent } = usePixelColors.getState(); return { fg, bg, recent: [...recent] }; }
