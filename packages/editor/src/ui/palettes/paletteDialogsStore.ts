import type { Collection } from "@smap/core";
import { create } from "zustand";
import { registerTilesetModal } from "../tilesetImport/importStore";

export const usePaletteDialogs = create<{
  paste: boolean;
  trim: { palette: Collection; rows: number } | null;
}>()(() => ({ paste: false, trim: null }));
export const openPalettePastePicker = () => usePaletteDialogs.setState({ paste: true });
export const requestPaletteTrim = (palette: Collection, rows: number) => usePaletteDialogs.setState({ trim: { palette, rows } });
registerTilesetModal(() => usePaletteDialogs.getState().paste || usePaletteDialogs.getState().trim !== null);
