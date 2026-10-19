import { useCallback, useSyncExternalStore } from "react";
import { tilesetStructureKey } from "./structureKey";
import type { MapStore } from "@smap/core";

import { getTilesetImage, onTilesetImage, type TilesetImage } from "../state/tilesetImages";

/** Revision of the last structural change (layers / tilesets / palette). */
const structureRevision = new WeakMap<MapStore, number>();

/**
 * Re-renders the caller when the document structure changes (not on every
 * painted cell). Returns a number that changes with the structure.
 */
export function useStructureVersion(store: MapStore | undefined): number {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!store) return () => undefined;
      let tilesets = tilesetStructureKey(store.document.tilesets);
      return store.subscribe((event) => {
        if (event.structure.length === 0) return;
        if (event.structure.includes('tilesets')) {
          const next = tilesetStructureKey(store.document.tilesets), same = next === tilesets; tilesets = next;
          if (same && event.structure.every(s => s === 'tilesets')) return;
        }
        structureRevision.set(store, event.revision);
        notify();
      });
    },
    [store],
  );
  return useSyncExternalStore(subscribe, () => (store ? (structureRevision.get(store) ?? 0) : 0));
}

/** The decoded image of a tileset; updates when it is (re)registered. */
export function useTilesetImage(tilesetId: string | null | undefined): TilesetImage | undefined {
  const subscribe = useCallback((notify: () => void) => onTilesetImage(() => notify()), []);
  return useSyncExternalStore(subscribe, () => (tilesetId ? getTilesetImage(tilesetId) : undefined));
}

const NO_HISTORY = "00";

/** `canUndo` / `canRedo` of the store, re-rendering only when they change. */
export function useHistoryState(store: MapStore | undefined): { canUndo: boolean; canRedo: boolean } {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!store) return () => undefined;
      return store.subscribe((event) => {
        if (event.historyChanged) notify();
      });
    },
    [store],
  );
  const key = useSyncExternalStore(subscribe, () =>
    store ? `${store.canUndo ? 1 : 0}${store.canRedo ? 1 : 0}` : NO_HISTORY,
  );
  return { canUndo: key[0] === "1", canRedo: key[1] === "1" };
}

/** Bumps whenever a tileset image is (re)registered, so thumbnails redraw. */
let imageVersion = 0;
const subscribeImages = (notify: () => void) =>
  onTilesetImage(() => {
    imageVersion++;
    notify();
  });

/** A number that changes whenever any tileset image is (re)registered. */
export function useImageVersion(): number {
  return useSyncExternalStore(subscribeImages, () => imageVersion);
}
