/**
 * Small fuzzy matcher for the command palette: query characters must appear
 * in order; consecutive runs, word starts and an early first hit score higher.
 * Case-insensitive and Turkish-friendly ("izgara" matches "Izgarayı",
 * "sil" matches "Şil…").
 */

const FOLD: Record<string, string> = { ı: "i", İ: "i", I: "i", ş: "s", ç: "c", ğ: "g", ö: "o", ü: "u", â: "a", î: "i", û: "u" };

function fold(ch: string): string {
  return FOLD[ch] ?? FOLD[ch.toLowerCase()] ?? ch.toLowerCase();
}

export interface FuzzyMatch {
  score: number;
  /** Indices of matched characters in the text (for highlighting). */
  indices: number[];
}

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1] ?? " ";
  return /[\s:./\-_(…]/.test(prev);
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = [...query.trim()].map(fold).filter((c) => c !== " ");
  if (q.length === 0) return { score: 0, indices: [] };
  const chars = [...text];
  const folded = chars.map(fold);

  const indices: number[] = [];
  let score = 0;
  let qi = 0;
  let last = -2;
  for (let i = 0; i < folded.length && qi < q.length; i++) {
    if (folded[i] !== q[qi]) continue;
    let bonus = 1;
    if (i === last + 1) bonus += 5;
    if (isWordStart(text, i)) bonus += 8;
    if (indices.length === 0) bonus += Math.max(0, 6 - i);
    score += bonus;
    indices.push(i);
    last = i;
    qi++;
  }
  if (qi < q.length) return null;
  // Prefer tighter matches and shorter texts.
  const first = indices[0] ?? 0;
  const spread = (indices.at(-1) ?? 0) - first + 1 - indices.length;
  score -= spread * 0.5 + chars.length * 0.05;
  return { score, indices };
}

/** Filters and sorts `items` by `fuzzyMatch(query, text(item))`; stable for equal scores. */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): { item: T; match: FuzzyMatch }[] {
  const results: { item: T; match: FuzzyMatch; order: number }[] = [];
  items.forEach((item, order) => {
    const match = fuzzyMatch(query, text(item));
    if (match) results.push({ item, match, order });
  });
  if (query.trim().length > 0) results.sort((a, b) => b.match.score - a.match.score || a.order - b.order);
  return results.map(({ item, match }) => ({ item, match }));
}
