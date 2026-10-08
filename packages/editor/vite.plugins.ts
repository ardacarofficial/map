/**
 * Vite plugins and chunking of the editor, shared by the browser build (`vite.config.ts`)
 * and the desktop shell's Vite app (`packages/desktop/vite.config.ts`), so
 * both compile the editor the same way.
 */
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { PluginOption } from "vite";

export function editorPlugins(): PluginOption[] {
  return [react(), tailwindcss()];
}

/**
 * Output chunking (`build.rolldownOptions.output.codeSplitting`).
 *
 * Long-lived vendor chunks: app code changes often, Pixi and React do not.
 * PixiJS is only reached through the on-demand canvas module
 * (`src/ui/canvas/loadCanvas.ts`), so it stays out of start-up. Vite's
 * dynamic-import helper is pinned to its own start-up chunk: left to
 * automatic chunking it landed in the pixi chunk and dragged PixiJS back in.
 */
export function editorCodeSplitting() {
  return {
    groups: [
      { name: "preload", test: /vite[\\/]preload-helper/, priority: 30 },
      { name: "pixi", test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:pixi\.js|@pixi)[\\/]/, priority: 20 },
      { name: "react", test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react|react-dom|scheduler)[\\/]/, priority: 20 },
      { name: "vendor", test: /[\\/]node_modules[\\/]/, priority: 10 }, // base-ui, zustand, …
    ],
  };
}
