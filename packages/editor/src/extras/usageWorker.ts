import type { PaletteEntry, TileUsage } from '@smap/core';

export function scanUsageFile(text: string, targets: readonly PaletteEntry[], signal: AbortSignal): Promise<TileUsage[]> {
  if (signal.aborted) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./usageFile.worker.ts', import.meta.url), { type: 'module' });
    const results: TileUsage[] = [];
    const finish = () => { signal.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { finish(); resolve([]); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ batch?: TileUsage[]; done?: boolean; error?: boolean }>) => {
      if (event.data.error) { finish(); reject(new Error('usage scan')); }
      else if (event.data.done) { finish(); resolve(results); }
      else if (event.data.batch) for (const usage of event.data.batch) results.push(usage);
    };
    worker.onerror = () => { finish(); reject(new Error('usage worker')); };
    worker.postMessage({ text, targets });
  });
}
