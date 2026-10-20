/**
 * The desktop shell's own Vite app: `index.html` + `src/main.ts`, which
 * starts the editor with the Tauri platform. Compiled with the editor's
 * plugins; run through the editor's Vite (`pnpm --filter @smap/editor exec
 * vite --config ../desktop/vite.config.ts`, see package.json scripts), so the
 * desktop package needs no build tooling of its own.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { editorAliases, editorCodeSplitting, editorPlugins } from "../editor/vite.plugins.ts";

const root = dirname(fileURLToPath(import.meta.url));

export default {
  root,
  plugins: editorPlugins(),
  resolve: { alias: editorAliases() },
  // Tauri serves the files from disk: relative URLs.
  base: "./",
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: {
    outDir: `${root}/dist`,
    emptyOutDir: true,
    // WebView2 (Chromium) and WebKitGTK of the supported OS versions.
    target: "es2022",
    chunkSizeWarningLimit: 600,
    rolldownOptions: { output: { codeSplitting: editorCodeSplitting() } },
  },
};
