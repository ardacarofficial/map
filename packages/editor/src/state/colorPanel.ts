import { create } from 'zustand';
import type { ColorFieldMode } from './colorFields';
export const useColorPanel = create<{ target: 'fg' | 'bg'; mode: ColorFieldMode; palette: number; view: 'picker' | 'palettes'; colorIndex: number | null }>()(() => ({ target: 'fg', mode: 'rgb', palette: 0, view: 'picker', colorIndex: null }));
