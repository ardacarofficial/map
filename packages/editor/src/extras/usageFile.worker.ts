import { parseLevel, tileUsageBatches, type PaletteEntry } from '@smap/core';

// Parsing/decompression of an unopened map must also stay off the UI thread.
self.onmessage = (event: MessageEvent<{ text: string; targets: PaletteEntry[] }>) => {
  try {
    const doc = parseLevel(event.data.text);
    for (const batch of tileUsageBatches(doc, event.data.targets)) if (batch.length) self.postMessage({ batch });
    self.postMessage({ done: true });
  } catch { self.postMessage({ error: true }); }
};
