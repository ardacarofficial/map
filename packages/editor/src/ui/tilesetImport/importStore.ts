/**
 * The open tileset card (import or settings). Callers `await openTilesetCard`
 * and get the confirmed name + grid, or `null` when cancelled. One card at a
 * time: several dropped files open one after another.
 */
import type { TileGridSpec } from "@smap/core";
import { create } from "zustand";

import type { GridDraft } from "./importModel";
import type { TileGridSuggestion } from "@smap/core";

export type CardMode =
  /** Welcome screen: the confirmed tile size becomes the new project's. */
  | { readonly kind: "new"; readonly mapWidth: number; readonly mapHeight: number }
  | { readonly kind: "add" }
  | { readonly kind: "edit"; readonly tilesetId: string };

export interface CardRequest {
  readonly mode: CardMode;
  readonly fileName: string;
  /** Decoded image (owned by the caller: never closed by the card). */
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
  /** Alpha channel (`width * height`), or `null` when it could not be read. */
  readonly alpha: Uint8Array | null;
  readonly initial: GridDraft;
  readonly suggestions: readonly TileGridSuggestion[];
  /** The open map's tile size (size mismatch note), `null` for a new project. */
  readonly mapTile: { readonly tileWidth: number; readonly tileHeight: number } | null;
}

export type CardResult =
  | { readonly kind: "confirm"; readonly name: string; readonly spec: TileGridSpec }
  /** Edit mode: "Görseli değiştir…" was chosen instead. */
  | { readonly kind: "replaceImage" };

interface CardState {
  request: CardRequest | null;
  resolve: ((result: CardResult | null) => void) | null;
  close(result: CardResult | null): void;
}

export const useTilesetCard = create<CardState>()((set, get) => ({
  request: null,
  resolve: null,
  close: (result) => {
    const resolve = get().resolve;
    set({ request: null, resolve: null });
    resolve?.(result);
  },
}));

let queue: Promise<unknown> = Promise.resolve();

/** Shows the card for `request` (after any card already open) and resolves with the user's choice. */
export function openTilesetCard(request: CardRequest): Promise<CardResult | null> {
  const run = () =>
    new Promise<CardResult | null>((resolve) => {
      useTilesetCard.setState({ request, resolve });
    });
  const next = queue.then(run, run);
  queue = next.catch(() => null);
  return next;
}

/** True while the card is open (modal: shortcuts stay off). */
export function tilesetCardOpen(): boolean {
  return useTilesetCard.getState().request !== null;
}
