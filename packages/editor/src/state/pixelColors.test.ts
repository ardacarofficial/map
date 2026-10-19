import { describe, expect, it } from 'vitest';
import { parsePixelColors, pixelColorSettings, usePixelColors } from './pixelColors';

describe('pixel colours extension contract', () => {
  it('canonicalizes HEX, swaps/resets, records recent committed colours and round trips settings', () => {
    const s = usePixelColors.getState(); s.reset(); s.clearRecent(); s.setFg('#f008'); s.setBg('#0f0');
    expect(pixelColorSettings()).toEqual({ fg: '#ff000088', bg: '#00ff00ff', recent: [] });
    s.addRecent(); s.addRecent('#ff000088'); expect(pixelColorSettings().recent).toEqual(['#ff000088']);
    s.swap(); expect(pixelColorSettings().bg).toBe('#ff000088');
    expect(parsePixelColors(JSON.parse(JSON.stringify(pixelColorSettings())))).toEqual(pixelColorSettings());
    expect(parsePixelColors({ fg: 'bad', bg: '#fff', recent: [] })).toBeNull();
    s.reset(); expect(pixelColorSettings().fg).toBe('#000000ff');
  });
});
