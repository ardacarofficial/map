import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { runCommand } from "../../commands/registry";
import { useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import "../history/historyVerbs";
import { HistoryPanel } from "../history/HistoryPanel";
import { WorldHint } from "../levels/WorldHint";
import { LayersPanel } from "../panels/LayersPanel";
import { InspectorBody } from "../inspector/Inspector";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Tabs } from "../primitives/Tabs";
import { Tooltip } from "../primitives/Tooltip";
import { useLayoutStore, type RightTab } from "./layoutStore";
import { ResizeHandle } from "./ResizeHandle";
import { SectionSplitter } from "./SectionSplitter";
import { clampSectionHeight, fillerSection, isCollapsed, sectionFlex, shownSections, splitterPairs, type SectionContext, type SectionId } from "./sections";

/** Props every right-column panel takes from the column. */
export interface SectionPanelProps {
  collapsed: boolean;
  onToggleCollapsed(): void;
  /** Trailing header control (the column's hide button on the top section). */
  extra?: ReactNode;
}

const TABS: readonly { id: RightTab; label: "inspector.title" | "history.title" }[] = [
  { id: "inspector", label: "inspector.title" },
  { id: "history", label: "history.title" },
];

/** "Denetçi | Geçmiş": the tab strip over the selected tab's panel. */
function RightTabs({ collapsed, onToggleCollapsed }: SectionPanelProps) {
  const tab = useLayoutStore((s) => s.rightTab);
  const setTab = useLayoutStore((s) => s.setRightTab);
  return (
    <section aria-label={t(tab === "history" ? "history.title" : "inspector.title")} className="flex min-h-0 flex-auto flex-col">
      <Tabs
        value={tab}
        label={t("inspector.title")}
        onValueChange={(id) => { setTab(id); if (collapsed) onToggleCollapsed(); }}
        items={TABS.map(({ id, label }) => ({ value: id, label: t(label), attrs: { "data-right-tab": id, onDoubleClick: onToggleCollapsed } }))}
        trailing={<HideInspectorButton />}
      />
      {!collapsed && (
        <div className="flex min-h-0 flex-auto flex-col" data-right-tab-body={tab}>
          {tab === "history" ? <HistoryPanel /> : <InspectorBody />}
        </div>
      )}
    </section>
  );
}

const PANELS: Record<"properties" | "layers", (props: SectionPanelProps) => ReactNode> = {
  properties: (p) => <RightTabs {...p} />,
  layers: (p) => <LayersPanel {...p} />,
};

/** "Denetçiyi gizle" in the top section's header. */
export function HideInspectorButton() {
  return (
    <Tooltip label={t("inspector.hide")} command="view.toggleInspector">
      <IconButton aria-label={t("inspector.hide")} size="sm" data-inspector-toggle onClick={() => runCommand("view.toggleInspector")}>
        <Icon name="panel-right" size={16} />
      </IconButton>
    </Tooltip>
  );
}

/**
 * The right column: tabs "Denetçi | Geçmiş" (content height), then Katmanlar filling
 * at the bottom. Katmanlar's header folds it; the splitter between them
 * resizes Katmanlar (height remembered, double-click: back to content
 * height). The column itself is resizable and can be hidden (Ctrl+Alt+B).
 * On the world map it only shows the world hint.
 */
export function RightColumn({ width, visible }: { width: number; visible: boolean }) {
  const world = useWorldView((s) => s.view === "world");
  const levelCount = useProjectLibrary((s) => s.levels.length);
  const sections = useLayoutStore((s) => s.sections);
  const ctx: SectionContext = { levelCount, world };
  const shown = shownSections(sections, ctx);
  const pairs = splitterPairs(sections, ctx);
  const filler = fillerSection(sections, ctx);
  const columnRef = useRef<HTMLElement>(null);
  const wraps = useRef(new Map<SectionId, HTMLDivElement>());
  const [columnHeight, setColumnHeight] = useState(0);

  useLayoutEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setColumnHeight(Math.round(entry.contentRect.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const measure = (id: SectionId) => wraps.current.get(id)?.getBoundingClientRect().height ?? 0;
  const clamp = (id: SectionId, height: number) =>
    clampSectionHeight(id, height, columnHeight || (columnRef.current?.clientHeight ?? 0), useLayoutStore.getState().sections, ctx);

  return (
    <aside
      ref={columnRef}
      aria-label={t("inspector.title")}
      style={{ width }}
      data-right-column=""
      className={`relative shrink-0 flex-col border-l border-line bg-panel ${visible ? "flex" : "hidden"}`}
    >
      <ResizeHandle column="right" edge="left" width={width} />
      {(shown as ("properties" | "layers")[]).map((id, index) => {
        const prev = shown[index - 1];
        const pair = prev !== undefined && pairs.some(([a, b]) => a === prev && b === id);
        const collapsed = isCollapsed(id, sections[id], ctx);
        const style = sectionFlex(id, sections, ctx);
        return (
          <Fragment key={id}>
            {pair && <SectionSplitter above={prev} below={id} filler={filler} measure={measure} clamp={clamp} />}
            <div
              ref={(el) => {
                if (el) wraps.current.set(id, el);
                else wraps.current.delete(id);
              }}
              data-section={id}
              style={style}
              className="flex min-h-0 flex-col overflow-hidden border-b border-line last:border-b-0"
            >
              {PANELS[id]({
                collapsed,
                onToggleCollapsed: () => useLayoutStore.getState().setSectionCollapsed(id, !collapsed),
                extra: index === 0 && id !== "properties" ? <HideInspectorButton /> : undefined,
              })}
            </div>
          </Fragment>
        );
      })}
      {world && <WorldHint />}
      {!world && shown.length === 0 && <AllHidden />}
    </aside>
  );
}

/** Every section is hidden from the View menu: say so instead of an empty column. */
function AllHidden() {
  const show = () => {
    const s = useLayoutStore.getState();
    for (const id of ["properties", "layers"] as const) s.setSectionHidden(id, false);
  };
  return (
    <div className="flex items-center gap-2 p-2">
      <div className="order-last ml-auto">
        <HideInspectorButton />
      </div>
      <span className="min-w-0 truncate text-sm text-muted">{t("inspector.sectionsHidden")}</span>
      <Button size="sm" onClick={show}>
        {t("inspector.showSections")}
      </Button>
    </div>
  );
}

/**
 * Thin strip at a canvas edge that brings a hidden side column back
 * (the column's own hide button, Ctrl+B / Ctrl+Alt+B and the View menu do too).
 */
export function EdgeReopen({ side, label, onClick }: { side: "left" | "right"; label: string; onClick(): void }) {
  return (
    <Tooltip label={label} command={side === "left" ? "view.toggleLibrary" : "view.toggleInspector"} side={side === "left" ? "right" : "left"}>
      <button
        type="button"
        aria-label={label}
        data-edge-reopen={side}
        onClick={onClick}
        className={`group grid w-3 shrink-0 place-items-center bg-panel text-faint transition-colors duration-100 hover:bg-hover hover:text-text ${
          side === "left" ? "border-r border-line" : "border-l border-line"
        }`}
      >
        <Icon name="chevronRight" size={12} className={side === "right" ? "rotate-180" : ""} />
      </button>
    </Tooltip>
  );
}
