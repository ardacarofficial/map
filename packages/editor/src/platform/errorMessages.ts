import { t } from '../i18n';

/** Native exceptions are diagnostic data; UI callers receive localized guidance. */
export function formatUiError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return t('toast.permissionDenied');
  if (name === 'SyntaxError') return t('errorMessages.invalidJson');
  return t('errorMessages.unexpected');
}
