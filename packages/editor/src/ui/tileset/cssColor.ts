/** Resolve a theme token for canvas drawing or data-colour fallbacks. */
export function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
