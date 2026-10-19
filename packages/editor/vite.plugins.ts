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
      // Grid helpers and stateless overlays share no app/store initialization.
      { name: "grid-models", test: /[\\/]packages[\\/]editor[\\/]src[\\/](?:ui[\\/]tileset[\\/](?:libraryModel|selectionModel|zoomModel|viewportModel|TilesetOverlays|cssColor|emptyTiles)|ui[\\/]palettes[\\/](?:paletteModel|paletteDraw)|canvas[\\/](?:brush|camera))\.tsx?$/, priority: 10 },
      // Raster helpers have no UI/store dependencies; keep their growing pixel code independently cached.
      { name: "stamp-raster", test: /[\\/]packages[\\/]editor[\\/]src[\\/](?:state[\\/](?:tilesetImages|tilesetPixels|pngHash|smartBrushProfile)|ui[\\/]stamps[\\/](?:smartStampBake|stampThumb)|export[\\/](?:pngComposite|pngRender))\.ts$/, priority: 10 },
      { name: "stamp-recipes", test: /[\\/]packages[\\/]editor[\\/]src[\\/]io[\\/](?:smartStampRecipes|fs|fileData)\.ts$/, priority: 10 },
      // Export targets and delivery share a cached chunk as new engines are added.
      { name: "export", test: /[\\/]packages[\\/]editor[\\/]src[\\/]export[\\/](?:export(?:Actions|Settings|Store|Files|Options)|targetRegistry|zip|targets[\\/][^\\/]+)\.ts$/, priority: 10 },
      // Map data model (pure, changes less often than the UI) and the local language layer.
      { name: "core", test: /[\\/]packages[\\/]core[\\/]src[\\/]/, priority: 10 },
      { name: "i18n", test: /[\\/]packages[\\/]editor[\\/]src[\\/]i18n[\\/]/, priority: 10 },
    ],
  };
}
