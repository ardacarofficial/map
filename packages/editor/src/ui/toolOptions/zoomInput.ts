/**
 * The zoom field of the options bar: what the user typed → a zoom factor.
 * Pure (tested). Accepts "150", "150%", "%150", "12,5" / "12.5"; the
 * canvas clamps the result to its limits.
 */

/** Zoom factor (1 = 100 %) for a typed percentage, or null when it is not a positive number. */
export function parseZoomPercent(text: string): number | null {
  const cleaned = text.replace(/\s+/g, "").replace(/%/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value / 100;
}

/** "12,5" / "33" / "150": a zoom factor as the field shows it (no % sign; one decimal at most, locale comma in Turkish). */
export function formatZoomPercent(zoom: number, locale: "tr" | "en"): string {
  const percent = Math.round(zoom * 1000) / 10;
  const text = Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
  return locale === "tr" ? text.replace(".", ",") : text;
}
