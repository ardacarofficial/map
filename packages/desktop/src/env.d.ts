/**
 * The editor's sources are type-checked here too (`@smap/editor` points at
 * its TS entry). They read `import.meta.env.DEV`; Vite's own client types
 * live in the editor package, so the one field is declared here.
 */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
