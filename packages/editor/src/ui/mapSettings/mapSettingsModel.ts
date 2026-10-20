import { manualEditAllowed } from "../../agent/editGate";
/**
 * Harita ayarları (map settings) — what "Uygula" changes. Pure so it is
 * testable without a DOM.
 *
 * - Size (with the 3×3 anchor) and background are level data: they go to
 *   the store as ops inside ONE transaction, so one Ctrl+Z undoes both.
 * - The name and the world position live in the project's level list
 *   (`project.smap`; like the other list edits they are not undo steps).
 */
import type { MapStore, Op } from "@smap/core";

import { resizeOffsets, type Anchor } from "../dialogs/resizeMath";

export const MAP_MIN = 1;
export const MAP_MAX = 4096;

export interface MapSettingsCurrent {
  name: string;
  width: number;
  height: number;
  background: string | null;
  /** World position of the level (pixels), or null when the project has no level list. */
  world: { x: number; y: number } | null;
}

export interface MapSettingsForm {
  name: string;
  width: number;
  height: number;
  anchor: Anchor;
  background: string | null;
  world: { x: number; y: number } | null;
}

export interface MapSettingsChanges {
  /** Level ops, applied in one transaction (empty: nothing undoable changes). */
  ops: Op[];
  /** New level name, or null when unchanged / empty. */
  rename: string | null;
  /** New world position, or null when unchanged. */
  world: { x: number; y: number } | null;
}

/** "#AbC" / "abcdef" / " #aabbcc " → "#aabbcc"; "" → null (no background); anything else → undefined (invalid). */
export function parseHexColor(text: string): string | null | undefined {
  const s = text.trim().replace(/^#/, "");
  if (s.length === 0) return null;
  if (/^[0-9a-fA-F]{3}$/.test(s)) return `#${[...s].map((c) => c + c).join("")}`.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`.toLowerCase();
  return undefined;
}

/** What applying `form` over `current` changes. */
export function mapSettingsChanges(current: MapSettingsCurrent, form: MapSettingsForm): MapSettingsChanges {
  const ops: Op[] = [];
  if (form.width !== current.width || form.height !== current.height) {
    const { offsetX, offsetY } = resizeOffsets(current, { width: form.width, height: form.height }, form.anchor);
    ops.push({ type: "resizeMap", width: form.width, height: form.height, offsetX, offsetY });
  }
  if (form.background !== current.background) ops.push({ type: "setMapProps", background: form.background });
  const name = form.name.trim();
  const rename = name.length > 0 && name !== current.name ? name : null;
  const world =
    form.world && current.world && (Math.round(form.world.x) !== current.world.x || Math.round(form.world.y) !== current.world.y)
      ? { x: Math.round(form.world.x), y: Math.round(form.world.y) }
      : null;
  return { ops, rename, world };
}

export function hasChanges(c: MapSettingsChanges): boolean {
  return c.ops.length > 0 || c.rename !== null || c.world !== null;
}

/** True when the new size cuts cells off. */
export function cropsMap(current: Pick<MapSettingsCurrent, "width" | "height">, form: Pick<MapSettingsForm, "width" | "height">): boolean {
  return form.width < current.width || form.height < current.height;
}

/**
 * Applies the level ops as one undo step (label: the step's name in
 * Geçmiş). Rolls back and rethrows when an op fails, so nothing half-applies.
 */
export function applyMapOps(store: Pick<MapStore, "beginTransaction" | "dispatch" | "commit" | "rollback">, ops: readonly Op[], label?: string): boolean {
  if (!manualEditAllowed()) return false;
  if (ops.length === 0) return false;
  store.beginTransaction(label);
  try {
    for (const op of ops) store.dispatch(op);
  } catch (error) {
    store.rollback();
    throw error;
  }
  store.commit();
  return true;
}
