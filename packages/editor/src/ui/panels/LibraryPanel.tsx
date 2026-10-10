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
import { LibrarySearch, LibrarySearchResults, useLibraryQuery } from "../layout/library/LibrarySearch";
import { TilesetList } from "../tileset/TilesetList";
import { runCommand } from "../../commands/registry";
import { PanelSection } from "./PanelSection";
import { ProjectTree } from "../levels/ProjectTree";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";

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

/** Tileset'ler: tileset cards and palettes (the tileset itself shows in the bottom dock). */
function TilesetTab() {
  return (
    <PanelSection
      title={t("panels.tileset")}
      heading={<LibraryTabs />}
      className="min-h-0 flex-1"
      actions={
        <Tooltip label={t("commands.tileset.add")} command="tileset.add">
          <IconButton aria-label={t("commands.tileset.add")} className="size-7" onClick={() => runCommand("tileset.add")}>
            <Icon name="plus" size={15} />
          </IconButton>
        </Tooltip>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto pt-1">
        <TilesetList />
      </div>
    </PanelSection>
  );
}

// Components are wrapped so the (circular) panel imports are only read at render time.
registerLibraryTab({ id: "stamps", label: "panels.stamps", order: 10, Component: () => <StampsPanel />, useBadge: useStampCount });
registerLibraryTab({ id: "tileset", label: "panels.tileset", order: 20, Component: () => <TilesetTab /> });
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
 * The left column. "library" (rail: Kütüphane): KÜTÜPHANE header, a search
 * over tilesets, stamps and maps, tabs "Stamp'ler | Tileset'ler" (+ "Entity"
 * next to an entity layer, + tabs added with `registerLibraryTab`) and the
 * PROJE tree underneath. "project" (rail: Proje): the PROJE tree alone.
 */
export function LibraryPanel() {
  const panel = useLayoutStore((s) => s.leftPanel);
  const world = useWorldViewFlag();
  if (panel === "project" || world) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-left-panel="project">
        <ProjectTree fill />
      </div>
    );
  }
  return <LibraryBody />;
}

function useWorldViewFlag(): boolean {
  return useWorldViewStore((s) => s.view === "world");
}

function LibraryBody() {
  const { listed, ctx } = useLibraryTabs();
  const selected = useUiStore((s) => s.libraryTab);
  const setTab = useUiStore((s) => s.setLibraryTab);
  const treeHidden = useLayoutStore((s) => s.sections.levels.hidden);
  const query = useLibraryQuery((s) => s.query);
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
  const Content = tab?.Component;
  return (
    <div className="flex h-full min-h-0 flex-col" data-left-panel="library">
      <header className="flex h-9 shrink-0 items-center gap-1 pr-1.5 pl-3">
        <h2 className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{t("layout.library")}</h2>
        <Tooltip label={t("layout.hideLibrary")} command="view.toggleLibrary">
          <IconButton
            aria-label={t("layout.hideLibrary")}
            data-library-hide=""
            className="ml-auto size-7"
            onClick={() => useLayoutStore.getState().setLibraryCollapsed(true)}
          >
            <Icon name="panels" size={14} className="-scale-x-100" />
          </IconButton>
        </Tooltip>
      </header>
      <LibrarySearch />
      {query.trim() !== "" ? (
        <LibrarySearchResults />
      ) : (
        Content && (
          <div className="flex min-h-0 flex-1 flex-col" data-library-tab={tab.id}>
            <Content />
          </div>
        )
      )}
      {!treeHidden && <ProjectTree />}
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
    <div className="-ml-3 flex h-full min-w-0 flex-1 items-stretch">
      <div role="tablist" aria-label={t("layout.library")} className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]">
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
              className={`relative flex min-w-0 flex-1 shrink-0 items-center justify-center gap-1.5 px-2 text-md transition-colors ${
                on ? "text-accent" : "text-muted hover:text-text"
              }`}
            >
              {t(label)}
              {useBadge && <Badge useCount={useBadge} on={on} />}
              <span aria-hidden className={`absolute right-0 bottom-0 left-0 h-0.5 ${on ? "bg-accent" : "bg-line-subtle"}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
