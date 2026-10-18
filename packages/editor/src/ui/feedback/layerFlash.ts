import { create } from "zustand";

/** How long a flashed layer row stays highlighted (ms). */
export const LAYER_FLASH_MS = 1600;

interface LayerFlashState {
  /** Layer whose row is highlighted right now, or null. */
  layerId: string | null;
  /** Changes on every flash so the same layer can flash again. */
  token: number;
}

export const useLayerFlash = create<LayerFlashState>()(() => ({ layerId: null, token: 0 }));

let timer: ReturnType<typeof setTimeout> | undefined;

/** Highlights the row of `layerId` for {@link LAYER_FLASH_MS}. */
export function flashLayer(layerId: string): void {
  if (timer !== undefined) clearTimeout(timer);
  useLayerFlash.setState((s) => ({ layerId, token: s.token + 1 }));
  timer = setTimeout(() => {
    timer = undefined;
    useLayerFlash.setState({ layerId: null });
  }, LAYER_FLASH_MS);
}
