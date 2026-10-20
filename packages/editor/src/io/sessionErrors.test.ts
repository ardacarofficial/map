import { afterEach, expect, it } from 'vitest';
import { getLocale, setLocale, t } from '../i18n';
import { describeError } from './session';
const locale = getLocale();
afterEach(() => setLocale(locale));
it.each(['tr', 'en'] as const)('localizes unknown IO errors without native details (%s)', language => {
  setLocale(language);
  for (const error of [new Error('private native failure'), 'Error: private failure', { toString: () => 'private failure' }]) {
    const text = describeError(error);
    expect(text).not.toMatch(/Error:|private|\[object Object\]/);
    expect(text.length).toBeGreaterThan(10);
  }
});
it.each(['tr', 'en'] as const)('keeps actionable JSON and permission guidance localized (%s)', language => {
  setLocale(language);
  const json = describeError(new SyntaxError('private parser details'));
  expect(json).toContain('JSON');
  expect(json).not.toContain('private');
  const permission = describeError(new DOMException('private path', 'NotAllowedError'));
  expect(permission).toBe(t('toast.permissionDenied'));
  expect(permission).not.toContain('private');
});
