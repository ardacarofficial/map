import { describe, expect, it } from 'vitest';
import { resolveBookmarkWorld, type WorldIdentityRecord } from './bookmarkWorld';

function handle(identity: string) { return { isSameEntry: async (other: unknown) => (other as { identity: string }).identity === identity, identity }; }
describe('bookmark world identity', () => {
  it('separates same-name worlds and recognizes reopened handles', async () => {
    const records: WorldIdentityRecord[] = [];
    const registry = { read: async () => records, write: async (record: WorldIdentityRecord) => { records.push(record); } };
    const a = await resolveBookmarkWorld(handle('a'), registry);
    const b = await resolveBookmarkWorld(handle('b'), registry);
    expect(a).not.toBe(b);
    expect(await resolveBookmarkWorld(handle('a'), registry)).toBe(a);
  });
  it('uses desktop paths and tolerates unavailable handle storage', async () => {
    expect(await resolveBookmarkWorld('C:/World')).toBe('path:C:/World');
    expect(await resolveBookmarkWorld(handle('a'), { read: async () => { throw Error('blocked'); }, write: async () => {} })).toBeNull();
    expect(await resolveBookmarkWorld(null)).toBeNull();
  });
});
