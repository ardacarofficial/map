/**
 * Vite plugins of the editor, shared by the browser build (`vite.config.ts`)
 * and the desktop shell's Vite app (`packages/desktop/vite.config.ts`), so
 * both compile the editor the same way.
 */
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { PluginOption } from "vite";

export function editorPlugins(): PluginOption[] {
  return [react(), tailwindcss()];
}
