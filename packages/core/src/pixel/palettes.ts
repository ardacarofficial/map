import type { WorldHistory } from './worldHistory';
export interface ColorPalette { readonly name: string; readonly colors: readonly string[] }
export const MAX_COLOR_PALETTES = 256;
export const MAX_PALETTE_COLORS = 4096;
export const COLORS_FILE_SUFFIX = '.smap-colors.json';
export function normalizeColorPalette(value: ColorPalette): ColorPalette {
  if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 256) throw new Error('palette name must contain 1–256 characters');
  if (!Array.isArray(value.colors) || value.colors.length > MAX_PALETTE_COLORS || !value.colors.every(c => typeof c === 'string' && /^#[0-9a-fA-F]{8}$/.test(c))) throw new Error('colors must be an array of at most 4096 #rrggbbaa values');
  return Object.freeze({ name: value.name, colors: Object.freeze(value.colors.map(c => c.toLowerCase())) });
}
export function normalizeColorPalettes(values: readonly ColorPalette[]): readonly ColorPalette[] {
  if (!Array.isArray(values) || values.length > MAX_COLOR_PALETTES) throw new Error('too many color palettes');
  return Object.freeze(values.map(normalizeColorPalette));
}
export function serializeColorPalette(palette: ColorPalette): string {
  return JSON.stringify({ version: 1, ...normalizeColorPalette(palette) }, null, 2) + '\n';
}
export function parseColorPalette(text: string): ColorPalette {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) throw new Error('unsupported color palette version');
  return normalizeColorPalette(value as ColorPalette);
}

export type ColorPaletteOp =
  | { readonly type: 'add'; readonly palette: ColorPalette }
  | { readonly type: 'replace'; readonly index: number; readonly palette: ColorPalette }
  | { readonly type: 'remove'; readonly index: number };

/** Pure project metadata. Owned immutable snapshots are replayed by world history. */
export class ColorPaletteStore {
  #palettes: readonly ColorPalette[];
  readonly #listeners = new Set<() => void>();
  constructor(palettes: readonly ColorPalette[]) { this.#palettes = normalizeColorPalettes(palettes); }
  get palettes(): readonly ColorPalette[] { return this.#palettes; }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  dispatch(op: ColorPaletteOp, history: WorldHistory, originMapId: string, label?: string): void {
    const before = this.#palettes, next = [...before];
    if (op.type === 'add') next.push(op.palette);
    else {
      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= next.length) throw new RangeError('palette index out of range');
      if (op.type === 'remove') next.splice(op.index, 1);
      else next[op.index] = op.palette;
    }
    const after = normalizeColorPalettes(next);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    history.projectEdit(originMapId, side => {
      this.#palettes = side === 'before' ? before : after;
      for (const listener of this.#listeners) listener();
    }, label);
  }
}
