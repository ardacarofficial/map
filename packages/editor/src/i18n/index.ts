/**
 * Translation helper. Every visible string goes through `t()`.
 * Turkish is the default; v0.5 adds a language switcher on top of `setLocale`.
 */
import { en } from "./en";
import { tr } from "./tr";
import type { MessageKey, MessageParams, Messages } from "./types";

export type { MessageKey, MessageParams, Messages } from "./types";

export type Locale = "tr" | "en";

const LOCALES: Record<Locale, Messages> = { tr, en };

let current: Messages = tr;
let currentLocale: Locale = "tr";

export function setLocale(locale: Locale): void {
  current = LOCALES[locale];
  currentLocale = locale;
  document.documentElement.lang = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/** Looks up `section.key` and fills `{placeholders}` from `params`. */
export function t(key: MessageKey, params?: MessageParams): string {
  const dot = key.indexOf(".");
  const section = key.slice(0, dot) as keyof Messages;
  const name = key.slice(dot + 1);
  const text = (current[section] as Record<string, string> | undefined)?.[name] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, p: string) => (p in params ? String(params[p]) : match));
}

/** Locale-aware number formatting for the status bar etc. */
export function formatNumber(value: number): string {
  return value.toLocaleString(currentLocale === "tr" ? "tr-TR" : "en-US");
}
