import type { WidthStorage } from "./columns";
import { defaultDockLayout, hidePanel, normalizeLayout, ZONE_IDS, clampZoneSize, type DockLayout } from "./dockModel";

export const LAYOUT_KEY = "smap.layout.v2";
export function layoutStorage(): WidthStorage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
function migrate(storage: WidthStorage | null): DockLayout {
  let layout = defaultDockLayout();
  const read = (name: string) => storage?.getItem(`smap.layout.${name}`);
  const flag = (name: string) => ["1", "true"].includes(read(name) ?? "");
  for (const [i, name] of ["libraryWidth", "rightWidth", "dockHeight"].entries()) {
    const value = read(name);
    if (value?.trim() && Number.isFinite(Number(value))) layout.zones[ZONE_IDS[i]!].expandedPx = clampZoneSize(ZONE_IDS[i]!, Number(value));
  }
  if (flag("libraryCollapsed")) layout.zones.left.state = "collapsed";
  if (flag("inspectorCollapsed")) layout.zones.right.state = "collapsed";
  if (flag("dockCollapsed")) layout.zones.bottom.state = "collapsed";
  if (flag("recentHidden")) layout.zones.bottom.state = "hidden";
  layout.rulersVisible = !flag("rulersHidden");
  const left = read("leftPanel");
  if (left === "project" || left === "library" || left === "stamps") layout.zones.left.groups[0]!.active = left === "project" ? "project" : "stamps";
  let sections: Record<string, { hidden?: boolean; collapsed?: boolean; height?: number; resetHeight?: number }> = {};
  try { sections = JSON.parse(read("sections") ?? "{}"); } catch { /* Invalid legacy sections. */ }
  if (sections && typeof sections === "object") {
    for (const [name, panels] of [["levels", ["project"]], ["properties", ["inspector", "history"]], ["layers", ["layers"]]] as const) {
      const section = sections[name];
      if (!section || typeof section !== "object") continue;
      if (section.hidden) for (const panel of panels) layout = hidePanel(layout, panel);
      const g = name === "levels" ? undefined : layout.zones.right.groups.find(item => item.tabs.some(p => (panels as readonly string[]).includes(p)));
      if (g) {
        g.collapsed = section.collapsed === true;
        const height = typeof section.height === "number" && Number.isFinite(section.height) && section.height > 0 ? section.height : section.resetHeight;
        if (typeof height === "number" && Number.isFinite(height) && height > 0) g.weight = height;
      }
    }
    // Legacy properties height and layers height are px, convert together when available.
    const right = layout.zones.right.groups;
    if (right.some(g => g.weight > 1)) for (const g of right) if (g.weight <= 1) g.weight = 200;
  }
  return normalizeLayout(layout) ?? defaultDockLayout();
}
export function readLayout(storage: WidthStorage | null, settingsLayout?: unknown): DockLayout {
  const settings = normalizeLayout(settingsLayout);
  if (settings) return settings;
  try {
    const raw = storage?.getItem(LAYOUT_KEY);
    if (raw !== null && raw !== undefined) {
      try { return normalizeLayout(JSON.parse(raw)) ?? defaultDockLayout(); } catch { return defaultDockLayout(); }
    }
    return migrate(storage);
  } catch { return defaultDockLayout(); }
}
export function writeLayout(storage: WidthStorage | null, layout: DockLayout): boolean {
  try { storage?.setItem(LAYOUT_KEY, JSON.stringify(layout)); return storage !== null; } catch { return false; }
}
