/**
 * State of "Arazi tanımla" (tileset ⚙ Düzenle → Arazi) and of "Düzelt".
 *
 * Define: the user drags a ROUGH rectangle over a terrain block; core
 * `detectTerrainBlock` finds the template and the exact origin from the
 * pixels. The best candidate is outlined in the tileset and previewed in
 * the Denetçi's ARAZİ card, where the user names it, picks a colour and a
 * background and presses "Tanımla" (`defineTerrain`, one undo step).
 *
 * Fix ("Düzelt"): clicks in the tileset tag corners (corner sets) or blob
 * zones of single tiles for one terrain — hand tagging, no rules.
 */
import { detectTerrainBlock, type DetectedTerrainBlock, type TileGridRect, type Tileset } from "@smap/core";
import { create } from "zustand";

import { terrainDefaults } from "../../commands/terrainActions";
import { useUiStore } from "../uiStore";
import { kindOfTemplate, type TerrainRef } from "./terrainModel";
import { tilesetPixels } from "./tilesetPixels";

/** Candidates kept for the "Şablon" list. */
const MAX_CANDIDATES = 6;

export interface TerrainDraft {
  readonly tilesetId: string;
  /** The rough rectangle the user dragged. */
  readonly rough: TileGridRect;
  /** Best first (one per template; the best origin of each). */
  readonly candidates: readonly DetectedTerrainBlock[];
  /** Chosen candidate. */
  readonly index: number;
  /** Add to this existing set (same kind), or null = a new set. */
  readonly setId: string | null;
  readonly name: string;
  readonly color: string;
  readonly background: number;
}

interface TerrainDraftState {
  draft: TerrainDraft | null;
  /** "Düzelt" target: clicks in the tileset tag this terrain's tiles. */
  fix: TerrainRef | null;
  setDraft(draft: TerrainDraft | null): void;
  patchDraft(patch: Partial<Omit<TerrainDraft, "tilesetId" | "rough" | "candidates">>): void;
  setFix(fix: TerrainRef | null): void;
}

export const useTerrainDraft = create<TerrainDraftState>()((set) => ({
  draft: null,
  fix: null,
  setDraft: (draft) => set({ draft }),
  patchDraft: (patch) => set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : {})),
  setFix: (fix) => set({ fix }),
}));

/**
 * One candidate per template (its best origin), best first, at most
 * {@link MAX_CANDIDATES}; zero-score candidates are dropped unless nothing
 * else is left.
 */
export function bestPerTemplate(all: readonly DetectedTerrainBlock[]): DetectedTerrainBlock[] {
  const seen = new Set<string>();
  const out: DetectedTerrainBlock[] = [];
  for (const c of all) {
    if (seen.has(c.template)) continue;
    seen.add(c.template);
    out.push(c);
  }
  const useful = out.filter((c) => c.score > 0);
  return (useful.length > 0 ? useful : out).slice(0, MAX_CANDIDATES);
}

/** Normalized rectangle of two tileset cells. */
export function roughRect(a: { col: number; row: number }, b: { col: number; row: number }): TileGridRect {
  const col = Math.min(a.col, b.col);
  const row = Math.min(a.row, b.row);
  return { col, row, columns: Math.abs(a.col - b.col) + 1, rows: Math.abs(a.row - b.row) + 1 };
}

/**
 * Starts a draft from a rough rectangle of `tileset`: runs the detection
 * (pixels decoded once and cached) and prefills name / colour. Keeps the
 * name, colour and set of a draft already open on the same tileset.
 * Returns false when nothing fits (no candidate).
 */
export function startDraft(tileset: Tileset, rough: TileGridRect): boolean {
  const pixels = tilesetPixels(tileset.id);
  let candidates: DetectedTerrainBlock[] = [];
  if (pixels) {
    try {
      candidates = bestPerTemplate(detectTerrainBlock(tileset, pixels, rough));
    } catch (error) {
      console.warn("[terrain] detection failed", error);
    }
  }
  if (candidates.length === 0) return false;
  const prev = useTerrainDraft.getState().draft;
  const keep = prev && prev.tilesetId === tileset.id;
  const kind = kindOfTemplate(candidates[0]!.template);
  const setId = keep && prev.setId && tileset.terrainSets?.find((s) => s.id === prev.setId)?.kind === kind ? prev.setId : null;
  const defaults = terrainDefaults(tileset.id, setId);
  useTerrainDraft.getState().setDraft({
    tilesetId: tileset.id,
    rough,
    candidates,
    index: 0,
    setId,
    name: keep ? prev.name : defaults.name,
    color: keep ? prev.color : defaults.color,
    background: keep && setId === prev.setId ? prev.background : 0,
  });
  useTerrainDraft.getState().setFix(null);
  return true;
}

/** Leaves define / fix (the draft is dropped). */
export function clearTerrainDraft(): void {
  const s = useTerrainDraft.getState();
  if (s.draft) s.setDraft(null);
  if (s.fix) s.setFix(null);
}

/** "Düzelt" on `ref`: opens the tileset's ⚙ Düzenle → Arazi with clicks tagging that terrain. */
export function startFix(ref: TerrainRef): void {
  const ui = useUiStore.getState();
  ui.setActiveTileset(ref.tilesetId);
  ui.setTilesetMode("terrain");
  useTerrainDraft.setState({ draft: null, fix: ref });
}

/** "+" in the Araziler list: opens ⚙ Düzenle → Arazi ready for a rough rectangle. */
export function startDefine(tilesetId?: string): void {
  const ui = useUiStore.getState();
  if (tilesetId) ui.setActiveTileset(tilesetId);
  ui.setTilesetMode("terrain");
  useTerrainDraft.setState({ fix: null });
}

// Leaving the terrain mode drops the draft and the fix target.
useUiStore.subscribe((s, prev) => {
  if (prev.tilesetMode === "terrain" && s.tilesetMode !== "terrain") clearTerrainDraft();
});
