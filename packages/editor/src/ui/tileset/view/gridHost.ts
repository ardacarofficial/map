import { createContext, type KeyboardEvent } from "react";

export interface GridHost {
  /** Focuses the viewport (keyboard). */
  focus(): void;
  /** True while Space is held or a pan drag runs: the left button pans instead. */
  panning(): boolean;
  /** Arrow / Esc keys for this tileset (null unregisters). Returns true when handled. */
  registerKeys(tilesetId: string, handler: ((event: KeyboardEvent) => boolean) | null): void;
  /** Scrolls so that `box` (px, relative to `grid`) is visible; centred when it was out of view and `center`. */
  reveal(grid: HTMLElement, box: { left: number; top: number; right: number; bottom: number }, center: boolean): void;
  /** Draw only while near the viewport (the stack). */
  lazy: boolean;
}

export const GridHostContext = createContext<GridHost | null>(null);

