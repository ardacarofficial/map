/** Stable translation facade. Turkish is the primary per-message fallback. */
import { createCatalog } from "./catalog";
import { localeResources } from "./resources";
import type { MessageKey, MessageParams } from "./types";

export type { MessageKey, MessageParams, Messages } from "./types";
export type { MessageArguments } from "./messages.generated";
export type { LocaleInfo } from "./catalog";

/** Discovered resource ids; adding a locale never requires editing a union. */
export type Locale = string;
const catalog = createCatalog(localeResources, message => console.warn(message));
export const availableLocales = catalog.availableLocales;
export const isAvailableLocale = catalog.hasLocale;
let currentLocale: Locale = "tr";
const listeners = new Set<() => void>();

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setLocale(locale: Locale): void {
  const next = isAvailableLocale(locale) ? locale : "tr";
  if (next !== locale) console.warn(`i18n: unknown locale ${locale}; falling back to tr`);
  if (typeof document !== "undefined") document.documentElement.lang = next;
  if (currentLocale === next) return;
  currentLocale = next;
  for (const listener of listeners) listener();
}

export function getLocale(): Locale { return currentLocale; }

/** Params stay compatible with existing string/number call sites. See MessageArguments for stricter callers. */
export function t(key: MessageKey, params?: MessageParams): string {
  return catalog.format(currentLocale, key, params);
}

export function formatNumber(value: number): string {
  return value.toLocaleString(currentLocale);
}
