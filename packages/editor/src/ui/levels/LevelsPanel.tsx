import { Menu } from "@base-ui/react/menu";
import type { ProjectLevel } from "@smap/core";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { askRemoveLevel, duplicateLevel, moveLevel, openNewLevelDialog, renameLevel, useLevelUi } from "../../commands/levelActions";
import { openLevelFromWorld, useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { openLevel } from "../../io/session";
import { useEditorStore } from "../../state/editorStore";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { RenameInput } from "../primitives/RenameInput";
import { Tooltip } from "../primitives/Tooltip";
import { dropIndex, rowShift } from "../panels/layerOrder";
import { PanelSection } from "../panels/PanelSection";
import type { SectionPanelProps } from "../layout/RightColumn";

/** Row height in px (keep in sync with `h-8`). */
const ROW = 32;
/** Pointer travel before a press turns into a drag. */
const DRAG_THRESHOLD = 4;

interface Drag {
  levelId: string;
  from: number;
  startY: number;
  dy: number;
  active: boolean;
}

/**
 * Level'lar (CLAUDE.md v1.0: "yan panelde level listesi"), top of the right
 * column: click opens a level, double-click renames, drag reorders, the row
 * menu duplicates or deletes. A dot marks levels with unsaved changes. List
 * edits are project-level and not undoable (deleting asks first).
 */
export function LevelsPanel({ collapsed, onToggleCollapsed, extra }: SectionPanelProps) {
  const levels = useProjectLibrary((s) => s.levels);
  const dirtyIds = useProjectLibrary((s) => s.dirtyLevelIds);
  const activeId = useEditorStore((s) => s.project?.levelId ?? null);
  const picking = useLevelUi((s) => s.pick !== null);
  // v1.2: on the world map the list is the only panel (taller), and a click opens the level in the level view.
  const world = useWorldView((s) => s.view === "world");
  const count = levels.length;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [settling, setSettling] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const dirty = new Set(dirtyIds);
  const activeName = levels.find((level) => level.id === activeId)?.name ?? null;

  useEffect(() => {
    if (!settling) return;
    const frame = requestAnimationFrame(() => setSettling(false));
    return () => cancelAnimationFrame(frame);
  }, [settling]);

  const to = drag?.active ? dropIndex(drag.from, drag.dy, ROW, count) : null;

  const onPointerDown = (event: ReactPointerEvent<HTMLLIElement>, level: ProjectLevel, index: number) => {
    if (event.button !== 0 || editingId === level.id || picking) return;
    // React events bubble out of portals (the row menu): only presses on the row itself count.
    if (!event.currentTarget.contains(event.target as Node)) return;
    if ((event.target as HTMLElement).closest("button, input")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = { levelId: level.id, from: index, startY: event.clientY, dy: 0, active: false };
    dragRef.current = next;
    setDrag(next);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLLIElement>) => {
    const current = dragRef.current;
    if (!current) return;
    const raw = event.clientY - current.startY;
    if (!current.active && Math.abs(raw) < DRAG_THRESHOLD) return;
    const dy = Math.max(-current.from * ROW, Math.min((count - 1 - current.from) * ROW, raw));
    const next = { ...current, dy, active: true };
    dragRef.current = next;
    setDrag(next);
  };
  const onPointerUp = (level: ProjectLevel) => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!current) return;
    if (!current.active) {
      void (world ? openLevelFromWorld(level.id) : openLevel(level.id));
      return;
    }
    const target = dropIndex(current.from, current.dy, ROW, count);
    if (target !== current.from) {
      setSettling(true);
      moveLevel(current.levelId, target);
    }
  };
  const onPointerCancel = () => {
    dragRef.current = null;
    setDrag(null);
  };

  return (
    <PanelSection
      title={t("levels.title")}
      className="flex-auto"
      collapsed={collapsed}
      extra={extra}
      heading={
        <button
          type="button"
          data-section-toggle=""
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("levels.expand") : t("levels.collapse")}
          title={collapsed && activeName !== null ? activeName : undefined}
          className="-ml-1 flex h-6 min-w-0 items-center gap-1 rounded-sm pr-1.5 pl-0.5 text-xs font-semibold tracking-wide text-muted hover:bg-hover hover:text-text"
        >
          <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={13} className="shrink-0 text-faint" />
          <span className="shrink-0">{t("levels.title")}</span>
          <span className="shrink-0 font-mono font-normal text-faint tabular">{count}</span>
          {collapsed && activeName !== null && (
            // Folded list: still say which level is open ("Level'lar 1 · Ana harita").
            <>
              <span aria-hidden className="shrink-0 font-normal text-faint">
                ·
              </span>
              <span data-levels-active-name="" className="min-w-0 truncate font-normal tracking-normal text-text">
                {activeName}
              </span>
            </>
          )}
        </button>
      }
      actions={
        <Tooltip label={t("levels.add")} command="level.new">
          <IconButton aria-label={t("levels.add")} className="size-7" disabled={picking} onClick={() => openNewLevelDialog()}>
            <Icon name="plus" size={15} />
          </IconButton>
        </Tooltip>
      }
    >
      {!collapsed && (
        <ul
          role="listbox"
          aria-label={t("levels.title")}
          className="relative flex min-h-0 flex-auto flex-col overflow-y-auto px-1.5 pb-1.5"
        >
          {levels.map((level, index) => {
            const isActive = level.id === activeId;
            const dragged = drag?.active && drag.levelId === level.id;
            const shift = drag?.active && to !== null ? rowShift(index, drag.from, to, ROW) : 0;
            const y = dragged ? drag.dy : shift;
            const unsaved = dirty.has(level.id);
            return (
              <li
                key={level.id}
                role="option"
                aria-selected={isActive}
                data-level-id={level.id}
                title={t("levels.rowHint")}
                onPointerDown={(e) => onPointerDown(e, level, index)}
                onPointerMove={onPointerMove}
                onPointerUp={() => onPointerUp(level)}
                onPointerCancel={onPointerCancel}
                onDoubleClick={(e) => {
                  if (!e.currentTarget.contains(e.target as Node)) return;
                  if (!picking && !(e.target as HTMLElement).closest("button")) setEditingId(level.id);
                }}
                style={{ transform: y ? `translateY(${y}px)` : undefined }}
                className={`group relative flex h-8 shrink-0 items-center gap-2 rounded-md pr-1 pl-2 text-md select-none ${
                  dragged
                    ? "z-10 cursor-grabbing bg-active shadow-popup"
                    : settling
                      ? ""
                      : "transition-transform duration-150 ease-(--ease-out)"
                } ${isActive ? "bg-active text-text" : "text-muted hover:bg-hover hover:text-text"}`}
              >
                {isActive && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent" />}
                <Icon name="map" size={14} className={`shrink-0 ${isActive ? "text-accent" : "text-faint"}`} />
                {editingId === level.id ? (
                  <RenameInput
                    initial={level.name}
                    label={t("levels.rename")}
                    onDone={(name) => {
                      setEditingId(null);
                      if (name !== null) renameLevel(level.id, name);
                    }}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate">{level.name}</span>
                )}
                {unsaved && editingId !== level.id && (
                  <span
                    role="img"
                    aria-label={t("levels.unsaved")}
                    title={t("levels.unsaved")}
                    data-level-dirty=""
                    className="size-1.5 shrink-0 rounded-full bg-warning"
                  />
                )}
                {editingId !== level.id && (
                  <LevelMenu
                    level={level}
                    canRemove={count > 1}
                    disabled={picking}
                    onRename={() => setEditingId(level.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PanelSection>
  );
}

/** "…" on a row: rename, duplicate, delete. */
function LevelMenu({
  level,
  canRemove,
  disabled,
  onRename,
}: {
  level: ProjectLevel;
  canRemove: boolean;
  disabled: boolean;
  onRename(): void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={disabled}
        render={
          <button
            type="button"
            aria-label={`${t("levels.more")}: ${level.name}`}
            className="grid size-6 shrink-0 place-items-center rounded-sm text-faint opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-aria-selected:opacity-100 hover:bg-hover hover:text-text focus-visible:opacity-100 data-popup-open:bg-hover data-popup-open:text-text data-popup-open:opacity-100"
          >
            <Icon name="more" size={14} />
          </button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className={menuPositionerClass}>
          <Menu.Popup className={menuPopupClass}>
            <Menu.Item className={menuItemClass} onClick={onRename}>
              <Icon name="pencilLine" size={15} className="shrink-0 text-muted" />
              {t("levels.rename")}
            </Menu.Item>
            <Menu.Item className={menuItemClass} onClick={() => void duplicateLevel(level.id)}>
              <Icon name="copy" size={15} className="shrink-0 text-muted" />
              <span className="flex-1">{t("levels.duplicate")}</span>
            </Menu.Item>
            <div className={menuSeparatorClass} />
            <Menu.Item
              className={`${menuItemClass} text-danger data-highlighted:bg-danger-soft`}
              disabled={!canRemove}
              onClick={() => askRemoveLevel(level.id)}
            >
              <Icon name="trash" size={15} className="shrink-0" />
              <span className="flex-1">{t("levels.remove")}</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
