/** Debug/perf-only wall-clock spans; each preparation owns its asynchronous measurements. */
export interface BrushProfile { readonly started: number; readonly spans: Record<string, number> }
export function brushProfile(): BrushProfile | undefined {
  return import.meta.env.DEV || import.meta.env.VITE_SMAP_DEBUG === "1" ? { started: performance.now(), spans: {} } : undefined;
}
export function profileSpan<T>(profile: BrushProfile | undefined, name: string, run: () => T): T {
  if (!profile) return run();
  const started = performance.now();
  try { return run(); } finally { profile.spans[name] = (profile.spans[name] ?? 0) + performance.now() - started; }
}
export async function profileAwait<T>(profile: BrushProfile | undefined, name: string, run: () => Promise<T>): Promise<T> {
  if (!profile) return run();
  const started = performance.now();
  try { return await run(); } finally { profile.spans[name] = (profile.spans[name] ?? 0) + performance.now() - started; }
}
