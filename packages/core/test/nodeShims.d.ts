// Minimal typings for the node built-ins used by test helpers (core has no @types/node).
declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
}
declare module "node:zlib" {
  export function inflateSync(data: Uint8Array): Uint8Array;
}
interface ImportMeta {
  readonly url: string;
}
