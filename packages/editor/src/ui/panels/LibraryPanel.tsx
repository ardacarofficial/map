import { isEntityLayer, type MapDocument, type TileLayer } from "@smap/core";
import { useEffect, useRef, useSyncExternalStore, type ComponentType } from "react";

import { t, type MessageKey } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { EntityPalette } from "../entities/EntityPalette";
import { useStructureVersion } from "../hooks";
import { StampsPanel } from "../stamps/StampsPanel";
import { useUiStore, type LibraryTab } from "../uiStore";
import { TilesetPanel } from "./TilesetPanel";

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
  /**
   * The tab's content: a full-height panel. It should render
   * `<PanelSection heading={<LibraryTabs />} className="min-h-0 flex-1">` so
   * the tab row stays on top.
   */
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
let version = 0;

/**
 * Adds a tab to the library column (or replaces one with the same id).
 * Returns a function that removes it.
 */
export function registerLibraryTab(tab: LibraryTabDef): () => void {
  tabs.set(tab.id, tab);
  version++;
  for (const l of [...listeners]) l();
  return () => {
    if (tabs.get(tab.id) !== tab) return;
    tabs.delete(tab.id);
    version++;
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
registerLibraryTab({ id: "tileset", label: "panels.tileset", order: 10, Component: () => <TilesetPanel /> });
registerLibraryTab({ id: "stamps", label: "panels.stamps", order: 20, Component: () => <StampsPanel />, useBadge: useStampCount });
registerLibraryTab({
  id: "entities",
  label: "panels.entities",
  order: 30,
  Component: () => <EntityPalette />,
  // Only next to an entity layer (tiles cannot go there); selected when one becomes active.
  visible: ({ layer }) => isEntityLayer(layer),
  auto: ({ layer }) => isEntityLayer(layer),
});

function useLibraryTabs(): { listed: LibraryTabDef[]; ctx: LibraryTabContext } {
  const store = useEditorStore((s) => s.project?.store);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  useStructureVersion(store);
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
  const doc = store?.document;
  const ctx = { doc, layer: activeLayerId ? doc?.getLayer(activeLayerId) : undefined };
  return { listed: libraryTabsFor(ctx), ctx };
}

/**
 * The library column (left): tabs "Tileset | Stamp" (+ "Entity" next to an
 * entity layer, + tabs added with `registerLibraryTab`), the selected tab
 * filling the full height.
 */
export function LibraryPanel() {
  const { listed, ctx } = useLibraryTabs();
  const selected = useUiStore((s) => s.libraryTab);
  const setTab = useUiStore((s) => s.setLibraryTab);
  const autoBefore = useRef(new Set<LibraryTab>());
  const returnTo = useRef<LibraryTab | null>(null);

  // `auto` tabs: select on the rising edge; when the condition ends, go back to where the user was.
  const autoNow = listed.filter((tab) => tab.auto?.(ctx)).map((tab) => tab.id);
  const autoKey = autoNow.join(",");
  useEffect(() => {
    const now = new Set(autoKey ? autoKey.split(",") : []);
    const before = autoBefore.current;
    const rising = [...now].find((id) => !before.has(id));
    const current = useUiStore.getState().libraryTab;
    if (rising && rising !== current) {
      returnTo.current = current;
      setTab(rising);
    } else if (!now.has(current) && before.has(current) && returnTo.current) {
      setTab(returnTo.current);
      returnTo.current = null;
    }
    autoBefore.current = now;
  }, [autoKey, setTab]);

  const tab = resolveLibraryTab(selected, listed);
  if (!tab) return null;
  const Content = tab.Component;
  return (
    <div className="flex h-full min-h-0 flex-col" data-library-tab={tab.id}>
      <Content />
    </div>
  );
}

function Badge({ useCount, on }: { useCount: () => number; on: boolean }) {
  const count = useCount();
  if (count <= 0) return null;
  return <span className={`font-mono text-2xs font-normal tabular ${on ? "text-muted" : "text-faint"}`}>{count}</span>;
}

/** The tab row; library tab contents put it in their section header (`heading`). */
export function LibraryTabs() {
  const { listed } = useLibraryTabs();
  const selected = useUiStore((s) => s.libraryTab);
  const setTab = useUiStore((s) => s.setLibraryTab);
  const current = resolveLibraryTab(selected, listed)?.id;
  return (
    <div role="tablist" aria-label={t("layout.library")} className="-ml-1.5 flex min-w-0 items-center gap-0.5 overflow-x-auto">
      {listed.map(({ id, label, useBadge }) => {
        const on = id === current;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            data-library-tab-button={id}
            onClick={() => setTab(id)}
            className={`relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold tracking-wide transition-colors ${
              on ? "bg-active text-text" : "text-faint hover:bg-hover hover:text-muted"
            }`}
          >
            {t(label)}
            {useBadge && <Badge useCount={useBadge} on={on} />}
          </button>
        );
      })}
    </div>
  );
}
