/**
 * Stamp library filters (round 5): search, category chip, favourites and
 * tag. Pure so the rules are testable; the panel keeps the choices in
 * `stampLibraryStore`.
 */
import type { Stamp } from "@smap/core";

export interface StampFilter {
  /** Free text: matches the name, category or a tag (case- and Turkish-accent-insensitive). */
  readonly query: string;
  /** Category chip; `null` = all. */
  readonly category: string | null;
  /** Only stamps marked ★. */
  readonly favoritesOnly: boolean;
  /** Tag chip; `null` = any. */
  readonly tag: string | null;
}

export const NO_FILTER: StampFilter = { query: "", category: null, favoritesOnly: false, tag: null };

const FOLD: Readonly<Record<string, string>> = { ı: "i", İ: "i", ş: "s", Ş: "s", ç: "c", Ç: "c", ğ: "g", Ğ: "g", ö: "o", Ö: "o", ü: "u", Ü: "u" };

/** Lower-case, Turkish letters folded to ASCII ("Çatı" → "cati"), for matching. */
export function foldText(text: string): string {
  return [...text]
    .map((ch) => FOLD[ch] ?? ch)
    .join("")
    .toLocaleLowerCase("en")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

/** True when `stamp` passes every part of `filter`. */
export function matchesStamp(stamp: Stamp, filter: StampFilter): boolean {
  if (filter.favoritesOnly && !stamp.favorite) return false;
  if (filter.category !== null && stamp.category !== filter.category) return false;
  if (filter.tag !== null && !(stamp.tags ?? []).includes(filter.tag)) return false;
  const words = foldText(filter.query).split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return true;
  const haystack = foldText([stamp.name, stamp.category ?? "", ...(stamp.tags ?? [])].join(" "));
  return words.every((w) => haystack.includes(w));
}

/** The stamps that pass `filter`, in library order. */
export function filterStamps(stamps: readonly Stamp[], filter: StampFilter): Stamp[] {
  return stamps.filter((s) => matchesStamp(s, filter));
}

export interface NamedCount {
  readonly name: string;
  readonly count: number;
}

const byName = (a: NamedCount, b: NamedCount) => a.name.localeCompare(b.name, "tr", { sensitivity: "base" });

function countBy(values: Iterable<string>): NamedCount[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort(byName);
}

/** Categories used by the library with their stamp counts, by name (uncategorized stamps are not listed). */
export function stampCategories(stamps: readonly Stamp[]): NamedCount[] {
  return countBy(stamps.flatMap((s) => (s.category ? [s.category] : [])));
}

/** Tags used by the library with their stamp counts, by name. */
export function stampTags(stamps: readonly Stamp[]): NamedCount[] {
  return countBy(stamps.flatMap((s) => [...(s.tags ?? [])]));
}

/**
 * The filter with chips that no longer exist dropped (the last stamp of a
 * category was moved, a tag removed): an empty grid behind a stale chip
 * would look like a lost library.
 */
export function pruneFilter(filter: StampFilter, stamps: readonly Stamp[]): StampFilter {
  const category = filter.category !== null && stamps.some((s) => s.category === filter.category) ? filter.category : null;
  const tag = filter.tag !== null && stamps.some((s) => s.tags?.includes(filter.tag!)) ? filter.tag : null;
  const favoritesOnly = filter.favoritesOnly && stamps.some((s) => s.favorite);
  if (category === filter.category && tag === filter.tag && favoritesOnly === filter.favoritesOnly) return filter;
  return { ...filter, category, tag, favoritesOnly };
}

/** Parses a tags text field ("orman, ev  ,  köy") into a tag list: trimmed, de-duplicated, blanks dropped. */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(",").map((t) => t.trim()).filter((t) => t.length > 0))];
}
