/**
 * The host the editor runs in. `startEditor` sets it once before the first
 * render; tests and the plain browser build get `browserPlatform`.
 */
import { browserPlatform } from "./browserPlatform";
import type { Platform } from "./types";

export * from "./types";
export { browserPlatform } from "./browserPlatform";

let current: Platform = browserPlatform;

export function setPlatform(platform: Platform): void {
  current = platform;
}

export function getPlatform(): Platform {
  return current;
}
