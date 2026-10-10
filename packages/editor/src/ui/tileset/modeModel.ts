/**
 * What a mouse button does on a tile in each tileset mode, as a pure
 * function (unit tested). One rule everywhere: the left button adds /
 * selects, the right button removes.
 *
 * - Seç: left selects; Alt + left (drag) adds the rectangle to the random
 *   brush (a plain Alt + click toggles one tile); right opens the tile's
 *   context menu (no edit).
 * - Katı (⚙ Düzenle): left (drag) marks solid, right (drag) unmarks.
 * - (There is no "Rastgele" mode any more: a legacy "random" value acts as Seç.)
 * - Arazi (⚙ Düzenle): left drags a rough rectangle over a terrain block
 *   (the program finds template and origin), or — while "Düzelt" is on —
 *   tags the clicked corner / zone; right drops the open draft.
 */
import type { MessageKey } from "../../i18n";
import type { TilesetMode } from "../uiStore";

export type TilePointerAction =
  | { readonly kind: "none" }
  | { readonly kind: "select" }
  /** Alt + left in Seç: a rectangle for the random brush (one cell = toggle that tile). */
  | { readonly kind: "randomRect" }
  | { readonly kind: "solid"; readonly solid: boolean }
  /** Arazi: drag a rough rectangle over a block. */
  | { readonly kind: "roughRect" }
  /** Arazi + "Düzelt": tag the clicked corner / zone. */
  | { readonly kind: "tagTile" }
  /** Arazi: drop the draft (right button). */
  | { readonly kind: "cancelDraft" };

export interface TilePointerContext {
  /** 0 = left, 2 = right (other buttons never reach a tile). */
  readonly button: number;
  readonly alt: boolean;
  /** A terrain draft is open (a block was found and waits for "Tanımla"). */
  readonly draft: boolean;
  /** "Düzelt" is on (clicks tag single tiles). */
  readonly fixing: boolean;
}

export function tilePointerAction(mode: TilesetMode, ctx: TilePointerContext): TilePointerAction {
  const left = ctx.button === 0;
  const right = ctx.button === 2;
  if (!left && !right) return { kind: "none" };
  switch (mode) {
    case "pick":
    case "random":
      if (!left) return { kind: "none" };
      return ctx.alt ? { kind: "randomRect" } : { kind: "select" };
    case "solid":
      return { kind: "solid", solid: left };
    case "terrain":
      if (left) return ctx.fixing ? { kind: "tagTile" } : { kind: "roughRect" };
      return ctx.draft ? { kind: "cancelDraft" } : { kind: "none" };
  }
}

/** True when a right-drag keeps applying the action over every tile it crosses. */
export function isStroke(action: TilePointerAction): boolean {
  return action.kind === "solid";
}

/** The context menu opens on right-click only in Seç (elsewhere the right button removes). */
export function contextMenuEnabled(mode: TilesetMode): boolean {
  return mode === "pick" || mode === "random";
}

/** Modes behind the tileset header's ⚙ "Düzenle" toggle (tagging tiles, not picking a brush). */
export const EDIT_MODES = ["solid", "terrain"] as const;

/** True when `mode` tags tiles (the ⚙ "Düzenle" toggle is on). */
export function isEditMode(mode: TilesetMode): boolean {
  return mode === "solid" || mode === "terrain";
}

/** The mode strip's "Sol: … · Sağ: …" hint. */
export const MODE_HINT: Record<TilesetMode, MessageKey> = {
  pick: "tilesetPanel.hintSelect",
  solid: "tilesetLib.hintSolid",
  random: "tilesetLib.hintRandom",
  terrain: "tilesetLib.hintTerrain",
};
