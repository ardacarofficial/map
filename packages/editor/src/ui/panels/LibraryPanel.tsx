import { isEntityLayer, type MapDocument, type TileLayer } from "@smap/core";
import { useEffect, useRef, useSyncExternalStore, type ComponentType } from "react";

import { t, type MessageKey } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { EntityPalette } from "../entities/EntityPalette";
import { useStructureVersion } from "../hooks";
import { StampsPanel } from "../stamps/StampsPanel";
import { useUiStore, type LibraryTab } from "../uiStore";
import { useLayoutStore } from "../layout/layoutStore";
import { useWorldView as useWorldViewStore } from "../../commands/worldActions";
import { Tabs } from "../primitives/Tabs";
import { SectionHeader } from "../primitives/SectionHeader";
import { ProjectTree } from "../levels/ProjectTree";

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
registerLibraryTab({ id: "stamps", label: "panels.stamps", order: 10, Component: () => <StampsPanel />, useBadge: useStampCount });
registerLibraryTab({
  id: "entities",
  label: "panels.entities",
  order: 30,
  Component: EntityTab,
  // Only next to an entity layer (tiles cannot go there); selected when one becomes active.
  visible: ({ layer }) => isEntityLayer(layer),
  auto: ({ layer }) => isEntityLayer(layer),
});

/** Supplies the title while legacy contents still pass the null LibraryTabs shim as a React element. */
function EntityTab() {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col [&:has(>section>header>h2)>header]:hidden">
      <SectionHeader title={t("panels.entities")} className="pointer-events-none absolute inset-x-0 top-0 pr-8" />
      <EntityPalette />
    </div>
  );
}

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

/** The persisted library/project tabs and their full-height content. */
export function LibraryPanel() {
  const panel = useLayoutStore((s) => s.leftPanel);
  const world = useWorldViewStore((s) => s.view === "world");
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
  const project = world || panel === "project";
  const Content = tab?.Component;
  const value = project ? "project" : (tab?.id ?? "stamps");
  return (
    <div className="flex h-full min-h-0 flex-col" data-left-panel={project ? "project" : "library"}>
      <Tabs
        label={t("library.tabs")}
        value={value}
        onValueChange={(id) => {
          const nextPanel = id === "project" ? "project" : "library";
          if (useLayoutStore.getState().leftPanel !== nextPanel) useLayoutStore.getState().showLeftPanel(nextPanel);
          if (id !== "project") setTab(id);
        }}
        items={[
          ...listed.map(({ id, label, useBadge }) => ({
            value: id,
            label: (
              <>
                {t(label)}
                {useBadge && <Badge useCount={useBadge} />}
              </>
            ),
            disabled: world,
            attrs: { "data-library-tab-button": id, ...(id === "stamps" ? { "data-rail": "library" } : {}) },
          })),
          { value: "project", label: t("project.title"), attrs: { "data-rail": "project", "data-library-tab-button": "project" } },
        ]}
      />
      <div className="flex min-h-0 flex-1 flex-col" data-library-tab={project ? "project" : tab?.id}>
        {project ? <ProjectTree fill /> : Content && <Content />}
      </div>
    </div>
  );
}

function Badge({ useCount }: { useCount: () => number }) {
  const count = useCount();
  return count > 0 ? (
    <span aria-hidden className="ml-1.5 text-xs text-faint tabular">
      {count}
    </span>
  ) : null;
}

/** Deprecated: LibraryPanel renders the tab strip itself; tab contents should not pass it as heading. */
export function LibraryTabs() {
  return null;
}
