import { SHORTCUTS } from "../../shortcuts/shortcuts";
import { compactOverrides, type Overrides } from "./shortcutDraft";
import { formatSettings } from "../settings";
export function draftObject(text: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SyntaxError("Expected a JSON object");
  return raw as Record<string, unknown>;
}
export function editDraft(text: string, patch: Record<string, unknown>): string {
  return formatSettings({ ...draftObject(text), ...patch });
}

/** Keep bindings from a future command registry while editing today's known commands. */
export function editShortcutDraft(text: string, overrides: Overrides): string {
  const raw = draftObject(text).shortcuts;
  const known = new Set<string>(SHORTCUTS.map(row => row.command));
  const future = raw && typeof raw === "object" && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).filter(([id]) => !known.has(id))) : {};
  return editDraft(text, { shortcuts: { ...future, ...compactOverrides(overrides) } });
}
