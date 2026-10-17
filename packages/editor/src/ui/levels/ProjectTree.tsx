import type { ProjectLevel } from "@smap/core";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { activeStampId, pickStamp } from "../../commands/stampActions";
import { moveLevel, openNewLevelDialog, renameLevel, useLevelUi } from "../../commands/levelActions";
import { useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { RowContextMenu } from "../contextMenus/RowContextMenu";
import { dropIndex, rowShift } from "../panels/layerOrder";
import { IconButton } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { RenameInput } from "../primitives/RenameInput";
import { Tooltip } from "../primitives/Tooltip";
import { mapItems, showMap } from "./DocumentTabs";

/** Row height in px (keep in sync with `h-6`). */
const ROW = 24;
/** Pointer travel before a press turns into a drag. */
const DRAG_THRESHOLD = 4;

interface Drag {
  levelId: string;
  from: number;
  startY: number;
  dy: number;
  active: boolean;
}

/** A folder row ("Haritalar", "Stamp'ler"): click folds it. */
function Folder({
  label,
  count,
  open,
  onToggle,
  actions,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle(): void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col">
      <div className="group flex h-6 shrink-0 items-center gap-1 rounded-sm pr-1 text-sm text-muted hover:bg-hover hover:text-text">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          data-tree-folder={label}
          className="flex h-full min-w-0 flex-1 items-center gap-1 text-left"
        >
          <Icon name={open ? "chevronDown" : "chevronRight"} size={12} className="shrink-0 text-faint" />
          <Icon name="folder" size={16} className="shrink-0 text-muted" />
          <span className="truncate">{label}</span>
          <span className="text-xs text-faint tabular">{count}</span>
        </button>
        {actions}
      </div>
      {open && children}
    </div>
  );
}

/** Project tree with maps opened by double-click/Enter and stamps placed by click. */
export function ProjectTree({ fill: _fill }: { fill?: boolean }) {
  const levelsCount = useProjectLibrary((s) => s.levels.length);
  return (
    <section aria-label={t("project.title")} data-project-tree="" className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-col overflow-y-auto p-2" data-levels-count={levelsCount}>
        <MapsFolder />
        <StampsFolder />
      </div>
    </section>
  );
}

function MapsFolder() {
  const levels = useProjectLibrary((s) => s.levels);
  const dirtyIds = useProjectLibrary((s) => s.dirtyLevelIds);
  const activeId = useEditorStore((s) => s.project?.levelId ?? null);
  const picking = useLevelUi((s) => s.pick !== null);
  const world = useWorldView((s) => s.view === "world");
  const [open, setOpen] = useState(true);
  const count = levels.length;
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [settling, setSettling] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const dirty = new Set(dirtyIds);
  const focusId = levels.some((level) => level.id === focusedId) ? focusedId : levels.some((level) => level.id === activeId) ? activeId : levels[0]?.id;

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
  const onPointerUp = () => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!current) return;
    if (!current.active) return;
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
    <Folder
      label={t("levels.title")}
      count={count}
      open={open}
      onToggle={() => setOpen(!open)}
      actions={
        <Tooltip label={t("levels.add")} command="level.new">
          <IconButton size="sm" aria-label={t("levels.add")} onClick={() => openNewLevelDialog()}>
            <Icon name="plus" size={16} />
          </IconButton>
        </Tooltip>
      }
    >
      <ul role="listbox" aria-label={t("levels.title")} className="relative flex flex-col">
        {levels.map((level, index) => {
          const isActive = !world && level.id === activeId;
          const dragged = drag?.active && drag.levelId === level.id;
          const shift = drag?.active && to !== null ? rowShift(index, drag.from, to, ROW) : 0;
          const y = dragged ? drag.dy : shift;
          const editing = editingId === level.id;
          return (
            <RowContextMenu
              key={level.id}
              disabled={picking || editing}
              items={() => mapItems(level.id, () => setEditingId(level.id))}
              render={
                <li
                  role="option"
                  aria-selected={isActive}
                  data-level-id={level.id}
                  tabIndex={level.id === focusId ? 0 : -1}
                  onFocus={() => setFocusedId(level.id)}
                  onClick={(e) => {
                    if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest("input, button")) return;
                    e.currentTarget.focus();
                  }}
                  onKeyDown={(e) => {
                    if (editing || picking || e.target !== e.currentTarget) return;
                    if (e.key === "Enter") {
                      e.preventDefault();
                      showMap(level.id);
                    } else if (e.key === "F2") {
                      e.preventDefault();
                      setEditingId(level.id);
                    } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
                      e.preventDefault();
                      const rows = [...e.currentTarget.parentElement!.querySelectorAll<HTMLElement>("[data-level-id]")];
                      const next =
                        e.key === "Home" ? 0 : e.key === "End" ? count - 1 : Math.max(0, Math.min(count - 1, index + (e.key === "ArrowDown" ? 1 : -1)));
                      rows[next]?.focus();
                    }
                  }}
                  onPointerDown={(e) => onPointerDown(e, level, index)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                  onDoubleClick={(e) => {
                    if (!e.currentTarget.contains(e.target as Node)) return;
                    if (!picking && !(e.target as HTMLElement).closest("button, input")) showMap(level.id);
                  }}
                  style={{ transform: y ? `translateY(${y}px)` : undefined }}
                  className={`group relative flex h-6 shrink-0 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-line items-center gap-1 rounded-sm pr-1.5 pl-8 text-sm select-none ${
                    dragged ? "z-10 cursor-grabbing bg-active" : settling ? "" : "transition-transform duration-150 ease-(--ease-out)"
                  } ${isActive ? "bg-accent-soft text-title ring-1 ring-inset ring-accent-line" : "text-text hover:bg-hover"}`}
                />
              }
            >
              <Icon name="map" size={16} className={`shrink-0 ${isActive ? "text-accent" : "text-muted"}`} />
              {editing ? (
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
              {dirty.has(level.id) && !editing && (
                <span role="img" aria-label={t("levels.unsaved")} title={t("levels.unsaved")} className="size-1.5 shrink-0 rounded-full bg-warning" />
              )}
            </RowContextMenu>
          );
        })}
      </ul>
    </Folder>
  );
}

function StampsFolder() {
  const stamps = useProjectLibrary((s) => s.stamps);
  const current = useEditorStore((s) => activeStampId(s.stamp));
  const [open, setOpen] = useState(false);
  return (
    <Folder label={t("project.stamps")} count={stamps.length} open={open} onToggle={() => setOpen(!open)}>
      {stamps.length === 0 ? (
        <span className="h-6 pl-4 text-sm leading-6 text-faint">{t("project.noStamps")}</span>
      ) : (
        <ul aria-label={t("project.stamps")} className="flex flex-col">
          {stamps.map((stamp) => {
            const on = stamp.id === current;
            return (
              <li key={stamp.id}>
                <TreeButton icon="stamp" label={stamp.name} on={on} onClick={() => pickStamp(stamp.id)} data={stamp.id} />
              </li>
            );
          })}
        </ul>
      )}
    </Folder>
  );
}

function TreeButton({ icon, label, on, onClick, data }: { icon: IconName; label: string; on: boolean; onClick(): void; data: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-tree-stamp={data}
      onClick={onClick}
      className={`flex h-6 w-full items-center gap-1 rounded-sm pr-1.5 pl-8 text-left text-sm ${on ? "bg-accent-soft text-title ring-1 ring-inset ring-accent-line" : "text-text hover:bg-hover"}`}
    >
      <Icon name={icon} size={16} className={`shrink-0 ${on ? "text-accent" : "text-muted"}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
