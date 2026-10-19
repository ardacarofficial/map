/** Image revisions own immutable PNG buffers. Share both in-flight and completed hashes. */
const hashes = new WeakMap<Uint8Array, Promise<string>>();
const completed = new WeakMap<Uint8Array, string>();
export function cachedPngHash(bytes: Uint8Array): string | undefined { return completed.get(bytes); }
export function pngHash(bytes: Uint8Array): Promise<string> {
  const hit = hashes.get(bytes); if (hit) return hit;
  const pending = crypto.subtle.digest("SHA-256", new Uint8Array(bytes)).then(hash => {
    const value = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
    completed.set(bytes, value); return value;
  });
  hashes.set(bytes, pending);
  void pending.catch(() => { if (hashes.get(bytes) === pending) hashes.delete(bytes); });
  return pending;
}
