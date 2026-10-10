/**
 * Opening the Harita ayarları dialog. The open flag is the old resize
 * dialog's (`uiStore.resizeOpen`) so modal checks keep working; `focus`
 * says which field gets focus ("map.resize" lands on the size).
 */
import { create } from "zustand";

import { useUiStore } from "../uiStore";

export type MapSettingsFocus = "name" | "size";

export const useMapSettingsFocus = create<{ focus: MapSettingsFocus }>()(() => ({ focus: "name" }));

export function openMapSettings(focus: MapSettingsFocus = "name"): void {
  useMapSettingsFocus.setState({ focus });
  useUiStore.getState().setResizeOpen(true);
}

export function closeMapSettings(): void {
  useUiStore.getState().setResizeOpen(false);
}
