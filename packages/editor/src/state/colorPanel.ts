import { create } from 'zustand';
import type { ColorFieldMode } from './colorFields';
export const useColorPanel = create<{ target: 'fg' | 'bg'; mode: ColorFieldMode; palette: number }>()(() => ({ target: 'fg', mode: 'rgb', palette: 0 }));
