/**
 * What a mouse button does on a tile in each tileset mode, as a pure
 * function (unit tested). One rule everywhere: the left button adds /
 * selects, the right button removes.
 *
 * - Seç: left selects (Alt + left toggles the random brush); right opens
 *   the tile's context menu (no edit).
 * - Katı: left (drag) marks solid, right (drag) unmarks.
 * - Rastgele: left (drag) adds to the random brush, right (drag) removes.
 * - Arazi: left places the block; right cancels a placed block, or, with
 *   none placed, removes the terrain under the cursor (undoable).
 */
import type { MessageKey } from "../../i18n";
import type { TilesetMode } from "../uiStore";

export type TilePointerAction =
  | { readonly kind: "none" }
  | { readonly kind: "select" }
  | { readonly kind: "randomToggle" }
  | { readonly kind: "solid"; readonly solid: boolean }
  | { readonly kind: "random"; readonly add: boolean }
  | { readonly kind: "placeBlock" }
  | { readonly kind: "cancelBlock" }
  | { readonly kind: "removeTerrain"; readonly terrainId: number };

export interface TilePointerContext {
  /** 0 = left, 2 = right (other buttons never reach a tile). */
  readonly button: number;
  readonly alt: boolean;
  /** A terrain block is placed and waits for its name. */
  readonly pending: boolean;
  /** Terrain whose block covers the tile, if any. */
  readonly terrainId: number | null;
}

export function tilePointerAction(mode: TilesetMode, ctx: TilePointerContext): TilePointerAction {
  const left = ctx.button === 0;
  const right = ctx.button === 2;
  if (!left && !right) return { kind: "none" };
  switch (mode) {
    case "pick":
      if (!left) return { kind: "none" };
      return ctx.alt ? { kind: "randomToggle" } : { kind: "select" };
    case "solid":
      return { kind: "solid", solid: left };
    case "random":
      return { kind: "random", add: left };
    case "terrain":
      if (left) return { kind: "placeBlock" };
      if (ctx.pending) return { kind: "cancelBlock" };
      return ctx.terrainId !== null ? { kind: "removeTerrain", terrainId: ctx.terrainId } : { kind: "none" };
  }
}

/** True when a right-drag keeps applying the action over every tile it crosses. */
export function isStroke(action: TilePointerAction): boolean {
  return action.kind === "solid" || action.kind === "random";
}

/** The context menu opens on right-click only in Seç (elsewhere the right button removes). */
export function contextMenuEnabled(mode: TilesetMode): boolean {
  return mode === "pick";
}

/** The mode strip's "Sol: … · Sağ: …" hint. */
export const MODE_HINT: Record<TilesetMode, MessageKey> = {
  pick: "tilesetPanel.hintSelect",
  solid: "tilesetLib.hintSolid",
  random: "tilesetLib.hintRandom",
  terrain: "tilesetLib.hintTerrain",
};
