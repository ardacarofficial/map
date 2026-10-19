/// <reference types="vite/client" />
/** Eager local text imports: no fetch, network loader, or runtime code execution. */
export const localeResources = import.meta.glob<string>("./locales/*/*.json", {
  eager: true,
  query: "?raw",
  import: "default",
});
