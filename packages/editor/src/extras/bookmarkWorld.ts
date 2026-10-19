/** Browser directory names are not identities. Persist handles separately from
 * the map format, using isSameEntry even when a reopened handle is a new object.
 */
export interface WorldIdentityRecord { readonly id: string; readonly handle: unknown }
export interface WorldIdentityRegistry { read(): Promise<WorldIdentityRecord[]>; write(record: WorldIdentityRecord): Promise<void> }

const browserRegistry: WorldIdentityRegistry = {
  async read() { return transact('readonly', store => store.getAll()); },
  async write(record) { await transact('readwrite', store => store.put(record)); },
};
function transact<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('smap-camera-worlds', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('worlds', { keyPath: 'id' }); };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('blocked'));
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('worlds', mode);
      const result = request(tx.objectStore('worlds'));
      tx.oncomplete = () => { db.close(); resolve(result.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
// Serialize read/compare/insert to avoid duplicate identities on initial save.
let queue: Promise<unknown> = Promise.resolve();
export function resolveBookmarkWorld(ref: unknown, registry: WorldIdentityRegistry = browserRegistry): Promise<string | null> {
  if (typeof ref === 'string') return Promise.resolve(`path:${ref}`);
  if (!ref || typeof ref !== 'object' || !('isSameEntry' in ref) || typeof ref.isSameEntry !== 'function') return Promise.resolve(null);
  const handle = ref as { isSameEntry(other: unknown): Promise<boolean> };
  const work = async () => {
    try {
      for (const record of await registry.read()) {
        try { if (await handle.isSameEntry(record.handle)) return record.id; } catch { /* A retired handle may no longer compare. */ }
      }
      const id = `directory:${crypto.randomUUID()}`;
      await registry.write({ id, handle: ref });
      return id;
    } catch { return null; }
  };
  const result = queue.then(work, work);
  queue = result;
  return result;
}
