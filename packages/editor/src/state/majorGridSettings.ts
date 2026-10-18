import { create } from "zustand";
import { DEFAULT_MAJOR_GRID, type MajorGridSettings } from "../canvas/majorGrid";

const PREFIX = "smap:major-grid:";
function valid(value: unknown): value is MajorGridSettings {
  if (!value || typeof value !== "object") return false;
  const s = value as MajorGridSettings;
  return Number.isInteger(s.interval) && (s.interval === 0 || s.interval >= 2 && s.interval <= 64) && Number.isSafeInteger(s.x) && Number.isSafeInteger(s.y) && Math.abs(s.x) <= 1_000_000 && Math.abs(s.y) <= 1_000_000;
}
export function loadMajorGrid(project: string): MajorGridSettings {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PREFIX + project) ?? "null");
    if (valid(value)) return { interval: value.interval, x: value.x, y: value.y };
  } catch { /* View settings remain usable when storage is unavailable. */ }
  return DEFAULT_MAJOR_GRID;
}
export function saveMajorGrid(project: string, settings: MajorGridSettings): void {
  try { localStorage.setItem(PREFIX + project, JSON.stringify(valid(settings) ? settings : DEFAULT_MAJOR_GRID)); } catch { /* Optional view persistence. */ }
}
export const useMajorGrid = create<{ project: string | null; settings: MajorGridSettings; update(patch: Partial<MajorGridSettings>): void }>((set, get) => ({
  project: null, settings: DEFAULT_MAJOR_GRID,
  update: patch => {
    const current = get(), settings = { ...current.settings, ...patch };
    if (!valid(settings)) return;
    set({ settings });
    if (current.project) saveMajorGrid(current.project, settings);
  },
}));
/** Session calls this at open/close and Save As. Level switches keep the same project view. */
export function selectMajorGridProject(project: string | null, preserve = false): void {
  const settings = preserve ? useMajorGrid.getState().settings : project ? loadMajorGrid(project) : DEFAULT_MAJOR_GRID;
  useMajorGrid.setState({ project, settings });
  if (preserve && project) saveMajorGrid(project, settings);
}
