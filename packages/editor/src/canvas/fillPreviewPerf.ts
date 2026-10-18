/** Optional timing hook for the production perf build; no log in ordinary builds. */
export function fillPreviewStarted(): number {
  return import.meta.env.DEV || import.meta.env.VITE_SMAP_DEBUG === "1" ? performance.now() : 0;
}

export function fillPreviewFinished(start: number): void {
  if (start === 0) return;
  const log = (window as unknown as { __smapPerf?: { fillPreviews?: number[] } }).__smapPerf;
  log?.fillPreviews?.push(performance.now() - start);
}
