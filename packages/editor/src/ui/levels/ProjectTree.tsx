import type { ProjectLevel } from "@smap/core";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { activeStampId, pickStamp } from "../../commands/stampActions";
import { moveLevel, openNewLevelDialog, renameLevel, useLevelUi } from "../../commands/levelActions";
import { useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { RowContextMenu } from "../contextMenus/RowContextMenu";
import { useLayoutStore } from "../layout/layoutStore";
import { dropIndex, rowShift } from "../panels/layerOrder";
import { IconButton } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { RenameInput } from "../primitives/RenameInput";
import { Tooltip } from "../primitives/Tooltip";
import { mapItems, showMap } from "./DocumentTabs";

/** Row height in px (keep in sync with `h-7`). */
const ROW = 28;
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
function Folder({ label, count, open, onToggle, actions, children }: { label: string; count: number; open: boolean; onToggle(): void; actions?: ReactNode; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col">
      <div className="group flex h-7 shrink-0 items-center gap-1 rounded-md pr-1 text-md text-muted hover:bg-hover hover:text-text">
        <button type="button" aria-expanded={open} onClick={onToggle} data-tree-folder={label} className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-1 text-left">
          <Icon name={open ? "chevronDown" : "chevronRight"} size={13} className="shrink-0 text-faint" />
          <Icon name="folder" size={14} className="shrink-0 text-faint" />
          <span className="truncate">{label}</span>
          <span className="font-mono text-2xs text-faint tabular">{count}</span>
        </button>
        {actions}
      </div>
      {open && children}
    </div>
  );
}

/**
 * The PROJE tree: Haritalar (the project's maps: click opens it as a tab,
 * double-click renames, drag reorders, right-click: map actions; a dot
 * marks unsaved maps) and Stamp'ler (click puts the stamp on the brush).
 * `fill` lets it take the whole column (Proje panel) instead of sitting
 * under the library.
 */
export function ProjectTree({ fill = false }: { fill?: boolean }) {
  const collapsed = useLayoutStore((s) => s.sections.levels.collapsed === true);
  const levelsCount = useProjectLibrary((s) => s.levels.length);
  const toggle = () => useLayoutStore.getState().setSectionCollapsed("levels", !collapsed);
  const folded = collapsed && !fill;
  return (
    <section
      aria-label={t("project.title")}
      data-project-tree=""
      className={`flex min-h-0 flex-col ${fill ? "flex-1" : "shrink-0 border-t border-line"}`}
      style={fill || folded ? undefined : { maxHeight: "45%" }}
    >
      <header className="flex h-9 shrink-0 items-center gap-1 pr-1.5 pl-3">
        {fill ? (
          <h2 className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{t("project.title")}</h2>
        ) : (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!folded}
            data-section-toggle=""
            className="-ml-1 flex h-6 items-center gap-1 rounded-sm pr-1.5 pl-0.5 text-xs font-semibold tracking-[0.06em] text-muted uppercase hover:bg-hover hover:text-text"
          >
            <Icon name={folded ? "chevronRight" : "chevronDown"} size={13} className="shrink-0 text-faint" />
            {t("project.title")}
          </button>
        )}
        <div className="ml-auto flex items-center">
          <Tooltip label={t("levels.add")} command="level.new">
            <IconButton aria-label={t("levels.add")} className="size-7" onClick={() => openNewLevelDialog()}>
              <Icon name="plus" size={15} />
            </IconButton>
          </Tooltip>
        </div>
      </header>
      {!folded && (
        <div className="flex min-h-0 flex-col overflow-y-auto px-1.5 pb-2" data-levels-count={levelsCount}>
          <MapsFolder />
          <StampsFolder />
        </div>
      )}
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [settling, setSettling] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const dirty = new Set(dirtyIds);

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
      showMap(level.id);
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
    <Folder label={t("levels.title")} count={count} open={open} onToggle={() => setOpen(!open)}>
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
                  className={`group relative flex h-7 shrink-0 items-center gap-2 rounded-md pr-1.5 pl-9 text-md select-none ${
                    dragged ? "z-10 cursor-grabbing bg-active shadow-popup" : settling ? "" : "transition-transform duration-150 ease-(--ease-out)"
                  } ${isActive ? "bg-accent-soft text-title" : "text-muted hover:bg-hover hover:text-text"}`}
                />
              }
            >
              <Icon name="map" size={14} className={`shrink-0 ${isActive ? "text-accent" : "text-faint"}`} />
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
        <span className="h-7 pl-9 text-sm leading-7 text-faint">{t("project.noStamps")}</span>
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
      className={`flex h-7 w-full items-center gap-2 rounded-md pr-1.5 pl-9 text-left text-md ${on ? "bg-accent-soft text-title" : "text-muted hover:bg-hover hover:text-text"}`}
    >
      <Icon name={icon} size={14} className={`shrink-0 ${on ? "text-accent" : "text-faint"}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
