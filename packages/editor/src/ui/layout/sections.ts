/**
 * Foldable / hideable panel sections: the right column's Denetçi | Geçmiş
 * tabs ("properties") and Katmanlar ("layers"), plus the library's PROJE
 * tree ("levels": hidden / folded only, it never sits in the right column).
 * Which are shown, folded to their header, and how tall the user dragged
 * them. Pure functions so clamping and persistence are testable without a
 * DOM; `layoutStore` wires them to React and localStorage.
 *
 * One expanded section is the "filler": it takes whatever height is left
 * (Katmanlar by default). The others are as tall as their content (no
 * height stored) or as tall as the user dragged them, and give way when
 * the column gets short (CSS `flex-shrink`, never below their minimum).
 */
import type { WidthStorage } from "./columns";

export type SectionId = "levels" | "properties" | "layers";

/** The right column, top to bottom (the PROJE tree lives in the library column). */
export const SECTION_ORDER: readonly SectionId[] = ["properties", "layers"];

/** Which expanded section takes the remaining height, in order of preference. */
const FILLER_PREFERENCE: readonly SectionId[] = ["layers", "properties"];

/** Height of the right-column tab strip and section headers. */
export const SECTION_HEADER = 28;

/** Smallest useful height of an expanded section (header included). */
export const SECTION_MIN: Record<SectionId, number> = {
  levels: SECTION_HEADER + 32 + 6,
  properties: 56,
  layers: SECTION_HEADER + 28 + 5 * 28,
};

export interface SectionState {
  /** Not shown at all (View menu). */
  hidden: boolean;
  /** Folded to its header. `null` (levels only) = automatic (open). */
  collapsed: boolean | null;
  /** Height the user dragged it to (CSS px, header included); `null` = automatic content/filler sizing. */
  height: number | null;
}

export type SectionsState = Record<SectionId, SectionState>;

export const DEFAULT_SECTIONS: SectionsState = {
  levels: { hidden: false, collapsed: null, height: null },
  properties: { hidden: false, collapsed: false, height: null },
  layers: { hidden: false, collapsed: false, height: null },
};

/** localStorage key of the sections state (one JSON object). */
export const SECTIONS_KEY = "smap.layout.sections";
/** Older key of the level list's folded flag (read once when no sections state is stored). */
export const LEGACY_LEVELS_COLLAPSED_KEY = "smap.levelsCollapsed";

/** What the layout needs to know about the world around the sections. */
export interface SectionContext {
  /** Number of maps in the project. */
  levelCount: number;
  /** World map view: the right column shows only the world hint. */
  world: boolean;
}

/** Whether a section is folded right now (the automatic state is open). */
export function isCollapsed(_id: SectionId, state: SectionState, _ctx: SectionContext): boolean {
  return state.collapsed ?? false;
}

/** Right-column sections present right now, top to bottom (none on the world map). */
export function shownSections(sections: SectionsState, ctx: SectionContext): SectionId[] {
  return ctx.world ? [] : SECTION_ORDER.filter((id) => !sections[id].hidden);
}

/** Shown sections that are open (not folded). */
export function openSections(sections: SectionsState, ctx: SectionContext): SectionId[] {
  return shownSections(sections, ctx).filter((id) => !isCollapsed(id, sections[id], ctx));
}

/** The open section that takes the remaining height, or null when all are folded / hidden. */
export function fillerSection(sections: SectionsState, ctx: SectionContext): SectionId | null {
  const open = openSections(sections, ctx);
  if (sections.layers.height !== null && open.includes("properties") && open.includes("layers")) return "properties";
  return FILLER_PREFERENCE.find((id) => open.includes(id)) ?? null;
}

/**
 * A splitter between two neighbouring open sections resizes the one that
 * is not the filler. `sign` is +1 when dragging down makes it taller (it is
 * above the splitter), -1 when dragging up does (below).
 */
export function splitterTarget(above: SectionId, below: SectionId, filler: SectionId | null): { section: SectionId; sign: 1 | -1 } {
  return above === filler ? { section: below, sign: -1 } : { section: above, sign: 1 };
}

/** Pairs of neighbouring open sections that get a splitter between them. */
export function splitterPairs(sections: SectionsState, ctx: SectionContext): [SectionId, SectionId][] {
  const open = openSections(sections, ctx);
  const shown = shownSections(sections, ctx);
  const pairs: [SectionId, SectionId][] = [];
  for (let i = 0; i + 1 < shown.length; i++) {
    const a = shown[i]!;
    const b = shown[i + 1]!;
    if (open.includes(a) && open.includes(b)) pairs.push([a, b]);
  }
  return pairs;
}

/**
 * Largest height `id` may take in a column of `columnHeight` px: every
 * other shown section keeps its minimum (or its header when folded).
 */
export function maxSectionHeight(id: SectionId, columnHeight: number, sections: SectionsState, ctx: SectionContext): number {
  let others = 0;
  for (const other of shownSections(sections, ctx)) {
    if (other === id) continue;
    others += isCollapsed(other, sections[other], ctx) ? SECTION_HEADER : SECTION_MIN[other];
  }
  return Math.max(SECTION_MIN[id], Math.floor(columnHeight - others));
}

/** `value` rounded and kept between the section's minimum and {@link maxSectionHeight} (NaN → minimum). */
export function clampSectionHeight(id: SectionId, value: number, columnHeight: number, sections: SectionsState, ctx: SectionContext): number {
  const min = SECTION_MIN[id];
  if (!Number.isFinite(value)) return min;
  const max = maxSectionHeight(id, columnHeight, sections, ctx);
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** CSS flex sizing of a section: header only, filler, dragged height, or content height. */
export function sectionFlex(id: SectionId, sections: SectionsState, ctx: SectionContext): { flex: string; minHeight: number; maxHeight?: number | string } {
  const state = sections[id];
  if (isCollapsed(id, state, ctx)) return { flex: "0 0 auto", minHeight: SECTION_HEADER };
  if (fillerSection(sections, ctx) === id) return { flex: "1 1 0px", minHeight: SECTION_MIN[id] };
  if (state.height !== null) return { flex: `0 1 ${state.height}px`, minHeight: SECTION_MIN[id] };
  return { flex: "0 1 auto", minHeight: SECTION_MIN[id], maxHeight: "60%" };
}

function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function readSection(raw: unknown, fallback: SectionState, id: SectionId): SectionState {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const height = typeof r.height === "number" && Number.isFinite(r.height) ? Math.max(SECTION_MIN[id], Math.round(r.height)) : null;
  const collapsed = isBool(r.collapsed) ? r.collapsed : id === "levels" ? null : fallback.collapsed;
  return { hidden: isBool(r.hidden) ? r.hidden : fallback.hidden, collapsed, height };
}

/** The stored sections state (defaults for anything missing or broken; storage errors → defaults). */
export function readSections(storage: WidthStorage | null): SectionsState {
  try {
    const raw = storage?.getItem(SECTIONS_KEY);
    if (raw == null || raw === "") {
      // First run of this layout: keep the level list's old folded choice.
      const legacy = storage?.getItem(LEGACY_LEVELS_COLLAPSED_KEY);
      const levels = legacy === "1" || legacy === "0" ? { ...DEFAULT_SECTIONS.levels, collapsed: legacy === "1" } : DEFAULT_SECTIONS.levels;
      return { ...DEFAULT_SECTIONS, levels };
    }
    const parsed: unknown = JSON.parse(raw);
    const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    return {
      levels: readSection(obj.levels, DEFAULT_SECTIONS.levels, "levels"),
      properties: readSection(obj.properties, DEFAULT_SECTIONS.properties, "properties"),
      layers: readSection(obj.layers, DEFAULT_SECTIONS.layers, "layers"),
    };
  } catch {
    return DEFAULT_SECTIONS;
  }
}

/** Stores the sections state (ignores storage errors: private mode just forgets). */
export function writeSections(storage: WidthStorage | null, sections: SectionsState): void {
  try {
    storage?.setItem(SECTIONS_KEY, JSON.stringify(sections));
  } catch {
    // Not remembered.
  }
}
