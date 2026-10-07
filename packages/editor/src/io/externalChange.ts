/**
 * "Dosya diskte değişti" detection. We remember the level text we last read
 * or wrote; when the window regains focus the file on disk is compared with
 * it. Our own writes update the remembered text, so they never count.
 */
export type DiskState = "same" | "changed" | "missing";

/** Line endings may be rewritten by git on Windows; that is not a change. */
function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * Compares the file on disk (`null` = it does not exist) with the text we
 * last read or wrote (`null` = nothing known yet, e.g. a project never saved).
 */
export function compareDisk(diskText: string | null, knownText: string | null): DiskState {
  if (knownText === null) return "same";
  if (diskText === null) return "missing";
  return normalize(diskText) === normalize(knownText) ? "same" : "changed";
}
