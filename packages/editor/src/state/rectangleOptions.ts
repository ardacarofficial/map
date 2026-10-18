import { create } from "zustand";

interface RectangleOptions {
  mode: "filled" | "outline";
  thickness: number;
  setMode(mode: RectangleOptions["mode"]): void;
  setThickness(thickness: number): void;
}

/** Transient tool options; rectangle sources consume geometry independently. */
export const useRectangleOptions = create<RectangleOptions>()(set => ({
  mode: "filled",
  thickness: 1,
  setMode: mode => set({ mode }),
  setThickness: value => {
    if (Number.isFinite(value)) set({ thickness: Math.max(1, Math.min(8, Math.round(value))) });
  },
}));

export function rectangleThickness(): number {
  const s = useRectangleOptions.getState();
  return s.mode === "outline" ? s.thickness : 0;
}
