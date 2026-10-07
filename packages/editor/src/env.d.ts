/**
 * Build-time flags of the editor. Merged with Vite's `ImportMetaEnv` here and
 * with the desktop package's own declaration (it includes this file).
 */
interface ImportMetaEnv {
  /** "1" in the perf harness build (`e2e/perf`): installs the `window.__smap` hook. */
  readonly VITE_SMAP_DEBUG?: string;
}
