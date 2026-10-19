import { IntlMessageFormat } from "intl-messageformat";
import { argumentSchema, type ArgumentSchema } from "./schema";

export interface LocaleInfo {
  id: string;
  nativeName: string;
  fallback: string;
  /** Fraction of valid translated keys, from 0 to 1 (fallbacks excluded). */
  completeness: number;
}
interface CatalogLocale {
  info: LocaleInfo;
  messages: Record<string, string>;
  schemas: Record<string, ArgumentSchema>;
}

/** Raw glob imports let us isolate bad optional JSON instead of failing the bundle. */
export function createCatalog(resources: Record<string, string>, diagnostic: (message: string) => void) {
  const reported = new Set<string>();
  const report = (message: string) => {
    if (reported.has(message)) return;
    reported.add(message);
    diagnostic(`i18n: ${message}`);
  };
  const files = new Map<string, Record<string, unknown>>();
  for (const [path, raw] of Object.entries(resources).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const match = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (!match) continue;
    const id = match[1]!;
    const feature = match[2]!;
    const entries = files.get(id) ?? {};
    files.set(id, entries);
    try { entries[feature] = JSON.parse(raw) as unknown; }
    catch { report(`${id}/${feature}: invalid JSON`); }
  }
  const locales = new Map<string, CatalogLocale>();
  const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
  for (const [id, features] of files) {
    const meta = features.meta;
    try {
      if (!object(meta) || meta.id !== id || typeof meta.nativeName !== "string" || !meta.nativeName.trim() || typeof meta.fallback !== "string") throw new Error();
      // BCP 47 ids only; no path fragments or executable resource formats.
      if (!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(id)) throw new Error();
      Intl.getCanonicalLocales(id);
      Intl.getCanonicalLocales(meta.fallback);
      const locale: CatalogLocale = { info: { id, nativeName: meta.nativeName, fallback: meta.fallback, completeness: 0 }, messages: {}, schemas: {} };
      for (const [feature, entries] of Object.entries(features)) {
        if (feature === "meta") continue;
        if (!object(entries)) { report(`${id}/${feature}: expected message object`); continue; }
        for (const [name, message] of Object.entries(entries)) {
          const key = `${feature}.${name}`;
          try {
            if (typeof message !== "string" || !message.length || !/^[\w.-]+$/.test(name)) throw new Error();
            locale.schemas[key] = argumentSchema(message, id);
            locale.messages[key] = message;
          } catch { report(`${id}:${key}: invalid message`); }
        }
      }
      locales.set(id, locale);
    } catch { report(`${id}: invalid locale metadata`); }
  }
  const primary = locales.get("tr");
  if (!primary) throw new Error("Missing Turkish locale resources");
  const keys = Object.keys(primary.messages);
  for (const [id, locale] of locales) {
    for (const key of Object.keys(locale.messages)) {
      if (!primary.schemas[key] || JSON.stringify(Object.keys(locale.schemas[key]!)) !== JSON.stringify(Object.keys(primary.schemas[key]!))) {
        report(`${id}:${key}: unknown key or mismatched arguments`);
        delete locale.messages[key];
        delete locale.schemas[key];
      }
    }
    locale.info.completeness = keys.length === 0 ? 0 : Object.keys(locale.messages).length / keys.length;
  }
  const formatters = new Map<string, IntlMessageFormat>();
  const availableLocales = (): LocaleInfo[] => [...locales.values()]
    .sort((a, b) => a.info.id === "tr" ? -1 : b.info.id === "tr" ? 1 : a.info.id < b.info.id ? -1 : 1)
    .map(l => ({ ...l.info }));
  return {
    availableLocales,
    hasLocale: (id: string) => locales.has(id),
    messages: (id: string) => ({ ...locales.get(id)?.messages }),
    schemas: (id: string) => ({ ...locales.get(id)?.schemas }),
    format(id: string, key: string, params: Readonly<Record<string, string | number>> = {}): string {
      const visited = new Set<string>();
      let candidate = id;
      while (!visited.has(candidate)) {
        visited.add(candidate);
        const locale = locales.get(candidate);
        const message = locale?.messages[key];
        if (locale && message !== undefined) {
          try {
            const cacheKey = `${candidate}:${key}`;
            let formatter = formatters.get(cacheKey);
            if (!formatter) {
              formatter = new IntlMessageFormat(message, candidate, undefined, { ignoreTag: true });
              formatters.set(cacheKey, formatter);
            }
            const values = { ...params };
            for (const [arg, kind] of Object.entries(locale.schemas[key]!)) {
              if (kind === "number") {
                if (typeof values[arg] === "string" && values[arg]!.toString().trim()) values[arg] = Number(values[arg]);
                if (typeof values[arg] !== "number" || !Number.isFinite(values[arg])) throw new Error("Invalid numeric argument");
              }
            }
            return String(formatter.format(values));
          } catch { report(`${candidate}:${key}: could not format message`); }
        } else report(`${candidate}:${key}: missing message; falling back to tr`);
        candidate = locale?.info.fallback ?? "tr";
        if (visited.has(candidate) && !visited.has("tr")) candidate = "tr";
      }
      // Invalid call-site parameters or an unknown key should never take down UI.
      return key;
    },
  };
}
