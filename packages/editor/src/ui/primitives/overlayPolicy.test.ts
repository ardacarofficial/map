import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeModalScope, canRestoreOverlayFocus, overlayPosition } from './overlayPolicy';
import { readFileSync } from 'node:fs';

afterEach(() => vi.unstubAllGlobals());

// Contract guard: a future popup family must use the shared positioner, rather
// than silently reintroducing its own edge padding or negative submenu gap.
describe('overlay contract', () => {
  it('keeps toast scope reads safe in the headless desktop host', () => {
    vi.stubGlobal('document', { documentElement: { lang: 'tr' } });
    expect(activeModalScope()).toBeNull();
  });
  it('flips and shifts with anchor clearance and viewport padding', () => {
    expect(overlayPosition).toMatchObject({ sideOffset: 6, collisionPadding: 8, collisionAvoidance: { side: 'flip', align: 'shift' }, sticky: true });
  });
  it('keeps background tooltips and feedback below modal controls', () => {
    const css = readFileSync(new URL('../../theme/tokens.css', import.meta.url), 'utf8');
    const token = (name: string) => Number(css.match(new RegExp(`--overlay-${name}:\\s*(\\d+)`))?.[1]);
    expect(token('popover')).toBeLessThan(token('modal-backdrop'));
    expect(token('tooltip')).toBeLessThan(token('modal-backdrop'));
    expect(token('toast')).toBeLessThan(token('modal-backdrop'));
    expect(token('modal')).toBeLessThan(token('modal-owned'));
  });
});

describe('closing overlay focus', () => {
  it.each([
    ['owner', false, true],
    [null, false, true],
    ['newer-modal', false, false],
    [null, true, false],
  ] as const)('open modal %s / outside focus %s restores: %s', (open, outside, expected) => {
    expect(canRestoreOverlayFocus('owner', open, outside)).toBe(expected);
  });
});
