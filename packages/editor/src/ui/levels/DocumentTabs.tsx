import { useEffect, useRef, useState } from "react";

import { askRemoveLevel, duplicateLevel, openNewLevelDialog, renameLevel, useLevelUi } from "../../commands/levelActions";
import { openLevelFromWorld, setCanvasView, useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { openLevel } from "../../io/session";
import { useEditorStore } from "../../state/editorStore";
import { SEPARATOR, type ContextEntry } from "../contextMenus/contextItems";
import { RowContextMenu } from "../contextMenus/RowContextMenu";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { RenameInput } from "../primitives/RenameInput";
import { Tooltip } from "../primitives/Tooltip";
import { StampDocTab, useStampEditorInstall } from "../stampEditor/StampEditorChrome";
import { leaveStampEditor } from "../stampEditor/stampEditorSession";
import { neighbourAfterClose, setDocTabs, syncTabs, useDocTabs } from "./docTabs";

/** Opens a map from a tab / the project tree (from the world map it also returns to the map view). */
export function showMap(id: string): void {
  // Round 5: a map tab / tree row leaves the stamp editor tab (which stays open).
  leaveStampEditor();
  void (useWorldView.getState().view === "world" ? openLevelFromWorld(id) : openLevel(id));
}

/** Closes a map's tab; closing the open map switches to its neighbour tab first. The last tab stays. */
export async function closeDocTab(id: string): Promise<void> {
  const ids = useDocTabs.getState().ids;
  const activeId = useEditorStore.getState().project?.levelId ?? null;
  if (id === activeId) {
    const next = neighbourAfterClose(ids, id);
    if (next === null) return;
    const ok = await openLevel(next);
    if (!ok) return;
  }
  setDocTabs(useDocTabs.getState().ids.filter((x) => x !== id));
}

/** Right-click on a map (tab or project tree row): rename, duplicate, delete (+ tab items). */
export function mapItems(id: string, onRename: () => void, extra: ContextEntry[] = []): ContextEntry[] {
  const count = useProjectLibrary.getState().levels.length;
  return [
    { type: "item", id: "rename", label: t("levels.rename"), icon: "pencilLine", run: onRename },
    { type: "item", id: "duplicate", label: t("levels.duplicate"), icon: "copy", run: () => void duplicateLevel(id) },
    ...extra,
    SEPARATOR,
    { type: "item", id: "remove", label: t("levels.remove"), icon: "trash", danger: true, disabled: count < 2, run: () => askRemoveLevel(id) },
  ];
}

/** Keeps the tab list in step with the open map and the project's map list. */
function useSyncTabs(activeId: string | null): void {
  const levels = useProjectLibrary((s) => s.levels);
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const levelIds = levels.map((l) => l.id);
    setDocTabs(syncTabs(useDocTabs.getState().ids, activeId, levelIds, previous.current));
    previous.current = activeId;
  }, [activeId, levels]);
}

/**
 * The document tabs row: open maps as tabs (click: switch, middle click /
 * ×: close, double-click: rename, right-click: map actions), "+" makes a
 * new map. On the world map a "Dünya" tab leads and is the active one.
 */
export function DocumentTabs() {
  const activeId = useEditorStore((s) => s.project?.levelId ?? null);
  const levels = useProjectLibrary((s) => s.levels);
  const dirtyIds = useProjectLibrary((s) => s.dirtyLevelIds);
  const ids = useDocTabs((s) => s.ids);
  const world = useWorldView((s) => s.view === "world");
  const picking = useLevelUi((s) => s.pick !== null);
  const [editingId, setEditingId] = useState<string | null>(null);
  useSyncTabs(activeId);
  useStampEditorInstall();
  const byId = new Map(levels.map((l) => [l.id, l]));
  const dirty = new Set(dirtyIds);
  const closable = ids.length > 1;

  return (
    <div className="flex h-tabrow min-w-0 flex-1 items-stretch" data-doc-tabs="">
      <div role="tablist" aria-label={t("docTabs.label")} className="flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none]">
        {world && (
          <div
            role="tab"
            aria-selected
            data-doc-tab="world"
            className="relative flex shrink-0 items-center gap-2 pr-1 pl-2 text-sm text-title"
          >
            <Icon name="map" size={16} className="text-accent" />
            {t("world.world")}
            <Tooltip label={t("world.back")}>
              <IconButton size="sm"
                aria-label={t("world.back")}
                onClick={() => setCanvasView("level")}
                className="hover:bg-hover"
              >
                <Icon name="x" size={16} />
              </IconButton>
            </Tooltip>
            <span aria-hidden className="absolute right-2 bottom-0 left-2 h-0.5 bg-accent" />
          </div>
        )}
        {ids.map((id) => {
          const level = byId.get(id);
          if (!level) return null;
          const active = !world && id === activeId;
          const editing = editingId === id;
          return (
            <RowContextMenu
              key={id}
              disabled={picking || editing}
              items={() =>
                mapItems(id, () => setEditingId(id), [
                  SEPARATOR,
                  { type: "item", id: "close", label: t("docTabs.close"), icon: "x", disabled: !closable, run: () => void closeDocTab(id) },
                  {
                    type: "item",
                    id: "closeOthers",
                    label: t("docTabs.closeOthers"),
                    disabled: !closable,
                    run: () => {
                      void (async () => {
                        leaveStampEditor();
                        if (id !== useEditorStore.getState().project?.levelId && !(await openLevel(id))) return;
                        setDocTabs([id]);
                      })();
                    },
                  },
                ])
              }
              render={
                <div
                  role="tab"
                  aria-selected={active}
                  data-doc-tab={id}
                  tabIndex={0}
                  onClick={(e) => {
                    if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest("button, input")) return;
                    if (!active && !picking) showMap(id);
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && !picking) {
                      e.preventDefault();
                      showMap(id);
                    }
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1 && closable && !picking) {
                      e.preventDefault();
                      void closeDocTab(id);
                    }
                  }}
                  onDoubleClick={(e) => {
                    if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest("button")) return;
                    if (!picking) setEditingId(id);
                  }}
                  className={`group relative flex max-w-45 min-w-0 shrink-0 cursor-default items-center gap-1.5 pr-1 pl-2 text-sm transition-colors duration-(--duration-fast) outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent focus-visible:bg-hover ${
                    active ? "text-title" : "text-muted hover:text-text"
                  }`}
                />
              }
            >
              {editing ? (
                <RenameInput
                  initial={level.name}
                  label={t("levels.rename")}
                  className="w-36"
                  onDone={(name) => {
                    setEditingId(null);
                    if (name !== null) renameLevel(id, name);
                  }}
                />
              ) : (
                <Tooltip label={level.name}><span className="min-w-0 truncate">{level.name}</span></Tooltip>
              )}
              {dirty.has(id) && !editing && (
                <span role="img" aria-label={t("levels.unsaved")} data-level-dirty="" className="size-1.5 shrink-0 rounded-full bg-warning" />
              )}
              <Tooltip label={t("docTabs.close")}><IconButton size="sm"
                aria-label={t("docTabs.closeNamed", { name: level.name })}
                disabled={!closable || picking}
                onClick={() => void closeDocTab(id)}
                className={`hover:bg-active disabled:invisible ${
                  active ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                }`}
              >
                <Icon name="x" size={16} />
              </IconButton></Tooltip>
              {active && <span aria-hidden className="absolute right-2 bottom-0 left-2 h-0.5 bg-accent" />}
            </RowContextMenu>
          );
        })}
        <StampDocTab disabled={picking} />
      </div>
      <Tooltip label={t("levels.add")} command="level.new">
        <IconButton size="md" aria-label={t("levels.add")} className="my-auto ml-1" disabled={picking} onClick={() => openNewLevelDialog()} data-doc-tab-new="">
          <Icon name="plus" size={16} />
        </IconButton>
      </Tooltip>
    </div>
  );
}
