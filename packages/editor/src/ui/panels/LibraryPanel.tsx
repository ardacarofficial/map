import { isEntityLayer, type MapDocument, type TileLayer } from "@smap/core";
import type { ComponentType } from "react";
import { DockZone } from "../layout/DockZone";
import { COLLAPSED_PX } from "../layout/dockModel";
import { useDockStore } from "../layout/dockStore";

import { type MessageKey } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { EntityPalette } from "../entities/EntityPalette";
import { StampsPanel } from "../stamps/StampsPanel";
import { type LibraryTab } from "../uiStore";

/** What a tab's `visible` / `auto` sees. */
export interface LibraryTabContext {
  doc: MapDocument | undefined;
  /** The active layer, if any. */
  layer: TileLayer | undefined;
}

export interface LibraryTabDef {
  id: LibraryTab;
  label: MessageKey;
  /** Left-to-right position; built-ins use 10, 20, 30. */
  order: number;
  /** Full-height content rendered below the library tab strip. */
  Component: ComponentType;
  /** When false the tab is not listed (defaults to always listed). */
  visible?(ctx: LibraryTabContext): boolean;
  /** When this turns true the tab is selected (e.g. Entity, once an entity layer becomes active). */
  auto?(ctx: LibraryTabContext): boolean;
  /** Small count after the label (e.g. number of stamps); 0 hides it. */
  useBadge?(): number;
}

const tabs = new Map<LibraryTab, LibraryTabDef>();
const listeners = new Set<() => void>();

/**
 * Adds a tab to the library column (or replaces one with the same id).
 * Returns a function that removes it.
 */
export function registerLibraryTab(tab: LibraryTabDef): () => void {
  tabs.set(tab.id, tab);
  for (const l of [...listeners]) l();
  return () => {
    if (tabs.get(tab.id) !== tab) return;
    tabs.delete(tab.id);
    for (const l of [...listeners]) l();
  };
}

/** Tabs listed for `ctx`, in order. */
export function libraryTabsFor(ctx: LibraryTabContext): LibraryTabDef[] {
  return [...tabs.values()].filter((tab) => tab.visible?.(ctx) ?? true).sort((a, b) => a.order - b.order);
}

/** The tab to show: the selected one when listed, else the first listed. */
export function resolveLibraryTab(selected: LibraryTab, listed: readonly LibraryTabDef[]): LibraryTabDef | undefined {
  return listed.find((tab) => tab.id === selected) ?? listed[0];
}

const useStampCount = () => useProjectLibrary((s) => s.stamps.length);

// Components are wrapped so the (circular) panel imports are only read at render time.
registerLibraryTab({ id: "stamps", label: "panels.stamps", order: 10, Component: () => <StampsPanel />, useBadge: useStampCount });
registerLibraryTab({
  id: "entities",
  label: "panels.entities",
  order: 30,
  Component: EntityPalette,
  // Only next to an entity layer (tiles cannot go there); selected when one becomes active.
  visible: ({ layer }) => isEntityLayer(layer),
  auto: ({ layer }) => isEntityLayer(layer),
});

/** Compatibility host; content and contextual visibility live in the dock registry. */
export function LibraryPanel() {
  const zone = useDockStore(s => s.layout.zones.left);
  return <DockZone zone="left" size={zone.state === "collapsed" ? COLLAPSED_PX : zone.expandedPx} temporaryHidden={false} />;
}
