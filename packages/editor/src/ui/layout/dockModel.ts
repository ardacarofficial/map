/** Flat docking model: no floating windows or recursive split trees. */
export const PANEL_IDS = ["tileset", "stamps", "project", "recent", "inspector", "history", "layers", "entities", "color"] as const;
export type PanelId = typeof PANEL_IDS[number];
export const ZONE_IDS = ["left", "right", "bottom"] as const;
export type ZoneId = typeof ZONE_IDS[number];
export type ZoneState = "expanded" | "collapsed" | "hidden";
export interface Group { id: string; tabs: PanelId[]; active: PanelId; weight: number; collapsed: boolean }
export interface Zone { state: ZoneState; expandedPx: number; mode: "tabs" | "split"; groups: Group[] }
export interface PanelHome { zone: ZoneId; groupId: string; groupIndex: number; tabIndex: number; weight: number }
export interface DockLayout { hiddenHomes: Partial<Record<PanelId, PanelHome>>; version: 2; zones: Record<ZoneId, Zone>; hiddenPanels: PanelId[]; rulersVisible: boolean }
export const ZONE_SIZES = {
  left: { initial: 260, min: 220, max: 400 },
  right: { initial: 296, min: 260, max: 420 },
  bottom: { initial: 68, min: 64, max: 480 },
} as const;
export const COLLAPSED_PX = 28;
export const isPanelId = (id: unknown): id is PanelId => typeof id === "string" && (PANEL_IDS as readonly string[]).includes(id);
export const isZoneId = (id: unknown): id is ZoneId => typeof id === "string" && (ZONE_IDS as readonly string[]).includes(id);
export function clampZoneSize(zone: ZoneId, n: number): number {
  const s = ZONE_SIZES[zone];
  return Number.isFinite(n) ? Math.min(s.max, Math.max(s.min, Math.round(n))) : s.initial;
}
const group = (id: string, tabs: PanelId[], weight = 1): Group => ({ id, tabs, active: tabs[0]!, weight, collapsed: false });
export function defaultDockLayout(): DockLayout {
  return {
    version: 2,
    zones: {
      left: { state: "expanded", expandedPx: 260, mode: "tabs", groups: [group("library", ["tileset", "stamps", "project", "entities"])] },
      right: { state: "expanded", expandedPx: 296, mode: "split", groups: [group("properties", ["inspector", "history", "color"], .6), group("layers", ["layers"], .4)] },
      bottom: { state: "expanded", expandedPx: 68, mode: "tabs", groups: [group("recent", ["recent"])] },
    },
    hiddenPanels: [], hiddenHomes: {}, rulersVisible: true,
  };
}
export function locatePanel(layout: DockLayout, panel: PanelId): { zone: ZoneId; group: number; index: number } | null {
  for (const zone of ZONE_IDS) for (const [index, g] of layout.zones[zone].groups.entries()) {
    const at = g.tabs.indexOf(panel);
    if (at >= 0) return { zone, group: index, index: at };
  }
  return null;
}
export function orderedPanels(zone: Zone): PanelId[] { return zone.groups.flatMap(g => g.tabs); }
export function copyLayout(layout: DockLayout): DockLayout { return JSON.parse(JSON.stringify(layout)) as DockLayout; }
function tidy(layout: DockLayout): DockLayout {
  for (const zone of ZONE_IDS) {
    const z = layout.zones[zone];
    z.groups = z.groups.filter(g => g.tabs.length);
    z.mode = z.groups.length > 1 ? "split" : "tabs";
    const sum = z.groups.reduce((s, g) => s + g.weight, 0);
    for (const g of z.groups) {
      if (!g.tabs.includes(g.active)) g.active = g.tabs[0]!;
      g.weight = Math.abs(sum - 1) < 1e-12 ? g.weight : sum > 0 ? g.weight / sum : 1 / z.groups.length;
    }
  }
  return layout;
}
export interface DockDestination { zone: ZoneId; group?: number; index?: number; split?: "start" | "end" }
export function movePanel(layout: DockLayout, panel: PanelId, target: DockDestination): DockLayout {
  const next = copyLayout(layout);
  const source = locatePanel(next, panel);
  const old = source ? next.zones[source.zone].groups[source.group]! : undefined;
  const z = next.zones[target.zone];
  // Resolve the target before removing the source: empty source groups disappear afterwards.
  let g = z.groups[target.group ?? 0];
  if (target.split || !g) {
    let n = 0;
    const ids = new Set(ZONE_IDS.flatMap(id => next.zones[id].groups.map(section => section.id)));
    while (ids.has(`group-${n}`)) n++;
    g = group(`group-${n}`, []);
    z.groups.splice(target.split === "start" ? 0 : z.groups.length, 0, g);
  }
  let index = target.index ?? g.tabs.length;
  if (source && old) {
    if (old === g && source.index < index) index--;
    old.tabs.splice(source.index, 1);
  }
  next.hiddenPanels = next.hiddenPanels.filter(id => id !== panel);
  delete next.hiddenHomes[panel];
  g.tabs.splice(Math.max(0, Math.min(index, g.tabs.length)), 0, panel);
  g.active = panel;
  g.collapsed = false;
  z.state = "expanded";
  return tidy(next);
}
export function hidePanel(layout: DockLayout, panel: PanelId): DockLayout {
  const next = copyLayout(layout);
  const at = locatePanel(layout, panel);
  if (at) {
    const source = layout.zones[at.zone].groups[at.group]!;
    next.hiddenHomes[panel] = { zone: at.zone, groupId: source.id, groupIndex: at.group, tabIndex: at.index, weight: source.weight };
  }
  for (const id of ZONE_IDS) for (const g of next.zones[id].groups) g.tabs = g.tabs.filter(p => p !== panel);
  if (!next.hiddenPanels.includes(panel)) next.hiddenPanels.push(panel);
  return tidy(next);
}
export function revealInLayout(layout: DockLayout, panel: PanelId): DockLayout {
  const at = locatePanel(layout, panel);
  if (!at) {
    const home = layout.hiddenHomes[panel];
    if (!home) return movePanel(layout, panel, locatePanel(defaultDockLayout(), panel)!);
    const next = copyLayout(layout), z = next.zones[home.zone];
    let index = z.groups.findIndex(g => g.id === home.groupId);
    if (index < 0) {
      const ids = new Set(ZONE_IDS.flatMap(zone => next.zones[zone].groups.map(g => g.id)));
      let id = home.groupId, suffix = 0;
      while (ids.has(id)) id = `restored-${suffix++}`;
      // A corrupt or externally edited group id must not create duplicate hosts.
      for (const h of Object.values(next.hiddenHomes)) if (h?.zone === home.zone && h.groupId === home.groupId) h.groupId = id;
      const weight = z.groups.length ? Math.max(.1, Math.min(.9, home.weight)) : 1;
      for (const g of z.groups) g.weight *= 1 - weight;
      index = Math.min(home.groupIndex, z.groups.length);
      z.groups.splice(index, 0, group(id, [], weight));
    }
    return movePanel(next, panel, { zone: home.zone, group: index, index: home.tabIndex });
  }
  const next = copyLayout(layout);
  const z = next.zones[at.zone];
  z.state = "expanded";
  z.groups[at.group]!.active = panel;
  z.groups[at.group]!.collapsed = false;
  return next;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** Null means an invalid root / future schema. Invalid entries inside v2 are repaired. */
export function normalizeLayout(raw: unknown): DockLayout | null {
  if (!record(raw) || raw.version !== 2 || !record(raw.zones)) return null;
  const next = defaultDockLayout();
  const seen = new Set<PanelId>();
  const ids = new Set<string>();
  for (const zone of ZONE_IDS) {
    const input = raw.zones[zone];
    if (!record(input) || !Array.isArray(input.groups)) return null;
    const z = next.zones[zone];
    z.state = input.state === "hidden" || input.state === "collapsed" ? input.state : "expanded";
    z.expandedPx = clampZoneSize(zone, typeof input.expandedPx === "number" ? input.expandedPx : NaN);
    z.groups = [];
    for (const [i, value] of input.groups.slice(0, PANEL_IDS.length).entries()) {
      if (!record(value) || !Array.isArray(value.tabs)) continue;
      const tabs = value.tabs.slice(0, 64).filter((id): id is PanelId => {
        if (!isPanelId(id) || seen.has(id)) return false;
        seen.add(id); return true;
      });
      if (!tabs.length) continue;
      let id = typeof value.id === "string" && /^[\w-]{1,64}$/.test(value.id) ? value.id : `${zone}-${i}`;
      if (ids.has(id)) id = `${zone}-${i}`;
      while (ids.has(id)) id += "-";
      ids.add(id);
      z.groups.push({ id, tabs, active: isPanelId(value.active) && tabs.includes(value.active) ? value.active : tabs[0]!, weight: typeof value.weight === "number" && Number.isFinite(value.weight) && value.weight > 0 ? Math.min(value.weight, 1e4) : 1, collapsed: value.collapsed === true });
    }
  }
  next.hiddenPanels = [];
  if (Array.isArray(raw.hiddenPanels)) for (const id of raw.hiddenPanels.slice(0, 64)) {
    if (isPanelId(id) && !seen.has(id)) { next.hiddenPanels.push(id); seen.add(id); }
  }
  if (record(raw.hiddenHomes)) for (const panel of next.hiddenPanels) {
    const h = raw.hiddenHomes[panel];
    if (!record(h) || !isZoneId(h.zone) || typeof h.groupId !== "string" || !/^[\w-]{1,64}$/.test(h.groupId)) continue;
    const index = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(PANEL_IDS.length - 1, Math.round(value))) : 0;
    next.hiddenHomes[panel] = { zone: h.zone, groupId: h.groupId, groupIndex: index(h.groupIndex), tabIndex: index(h.tabIndex), weight: typeof h.weight === "number" && Number.isFinite(h.weight) && h.weight > 0 ? Math.min(1, h.weight) : 1 };
  }
  const defaults = defaultDockLayout();
  for (const panel of PANEL_IDS) if (!seen.has(panel)) {
    const at = locatePanel(defaults, panel)!;
    const z = next.zones[at.zone];
    const original = defaults.zones[at.zone].groups[at.group]!;
    let g = z.groups.find(item => item.id === original.id);
    if (!g) {
      let id = original.id;
      while (ids.has(id)) id += "-";
      ids.add(id); g = group(id, []); z.groups.push(g);
    }
    g.tabs.push(panel);
  }
  next.rulersVisible = raw.rulersVisible !== false;
  return tidy(next);
}
