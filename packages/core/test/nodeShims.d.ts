// Minimal typings for the node built-ins used by test helpers (core has no @types/node).
declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: "utf8"): string;
}
declare module "node:zlib" {
  export function inflateSync(data: Uint8Array): Uint8Array;
}
interface ImportMeta {
  readonly url: string;
}

declare module "node:crypto" {
  export function createHash(name: string): { update(data: Uint8Array | string): { digest(encoding: "hex"): string } };
}
