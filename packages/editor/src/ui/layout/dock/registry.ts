/**
 * Tabs of the bottom dock under the canvas ("Tileset | Son kullanılanlar").
 * Features add their tab with `registerDockTab`; the dock lists the
 * registered tabs by `order` (lower first, left to right). Built-in:
 * "recent" (Son kullanılanlar, order 20). The tileset view registers
 * "tileset" (order 10).
 */
import type { ComponentType } from "react";
import { useSyncExternalStore } from "react";

import type { MessageKey } from "../../../i18n";

export interface DockTab {
  /** Unique id; registering the same id again replaces the tab. */
  id: string;
  label: MessageKey;
  /** Left-to-right position; built-ins use 10, 20. */
  order: number;
  /** The tab's content; fills the dock body (flex column, full height, no own tab strip). */
  Component: ComponentType;
  /** Optional trailing controls in the tab strip while this tab is selected. */
  Actions?: ComponentType;
}

const tabs = new Map<string, DockTab>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version++;
  for (const l of [...listeners]) l();
}

/** Adds (or replaces) a dock tab. Returns a function that removes it. */
export function registerDockTab(tab: DockTab): () => void {
  tabs.set(tab.id, tab);
  changed();
  return () => {
    if (tabs.get(tab.id) !== tab) return;
    tabs.delete(tab.id);
    changed();
  };
}

/** Registered tabs in display order. */
export function dockTabs(): DockTab[] {
  return [...tabs.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** True when a tab with this id is registered (e.g. the library hides its own tileset view once the dock has one). */
export function hasDockTab(id: string): boolean {
  return tabs.has(id);
}

export function subscribeDock(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function dockVersion(): number {
  return version;
}

/** React: re-render when tabs are added or removed. */
export function useDockVersion(): number {
  return useSyncExternalStore(subscribeDock, dockVersion);
}
