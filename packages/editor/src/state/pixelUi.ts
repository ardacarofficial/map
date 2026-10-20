import type { MapStore, PixelPoint } from '@smap/core';
import { create } from 'zustand';
import { useEditorStore, type ToolId } from './editorStore';
import type { PixelScope } from '../canvas/pixelEditing';
interface PixelUi {
  mode: 'tile' | 'pixel'; size: number; shape: 'square' | 'circle'; scope: PixelScope;
  fillMode: 'contiguous' | 'global'; filled: boolean; mirrorH: boolean; mirrorV: boolean;
  mirrorOrigins: WeakMap<MapStore, PixelPoint>; originRevision: number;
  pending: boolean; hover: { x: number; y: number } | null;
  tileTool: ToolId; pixelTool: ToolId;
  setMode(mode: 'tile' | 'pixel'): void; setSize(size: number): void;
}
const modeListeners = new Set<() => void>();
/** Controllers cancel pending gestures synchronously before mode state changes. */
export function beforePixelModeChange(listener: () => void): () => void { modeListeners.add(listener); return () => modeListeners.delete(listener); }
export const usePixelUi = create<PixelUi>()((set, get) => ({
  mode: 'tile', size: 1, shape: 'square', scope: 'cell', fillMode: 'contiguous', filled: false,
  mirrorOrigins: new WeakMap(), originRevision: 0,
  mirrorH: false, mirrorV: false, pending: false, hover: null, tileTool: 'brush', pixelTool: 'brush',
  setMode: mode => {
    const prev = get(); if (prev.mode === mode) return;
    for (const listener of modeListeners) listener();
    const tool = useEditorStore.getState().tool;
    set({ mode, ...(prev.mode === 'tile' ? { tileTool: tool } : { pixelTool: tool }) });
    useEditorStore.getState().setTool(mode === 'pixel' ? prev.pixelTool : prev.tileTool);
  },
  setSize: size => { if (Number.isFinite(size)) set({ size: Math.max(1, Math.min(64, Math.round(size))) }); },
}));
