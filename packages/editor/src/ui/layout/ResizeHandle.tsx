import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { t } from "../../i18n";
import { COLUMNS, type ColumnId } from "./columns";
import { useLayoutStore } from "./layoutStore";

/**
 * Drag handle on the inner edge of a side column. Drag resizes (clamped to
 * the column's min/max, stored on release), double-click restores the
 * initial width, arrow keys nudge it when focused.
 */
export function ResizeHandle({ column, edge, width }: { column: ColumnId; edge: "left" | "right"; /** The column's width as laid out. */ width: number }) {
  const setWidth = useLayoutStore((s) => s.setWidth);
  const commit = useLayoutStore((s) => s.commitWidth);
  const reset = useLayoutStore((s) => s.resetWidth);
  const drag = useRef<{ startX: number; startWidth: number; moved: boolean } | null>(null);
  // Handle on the right edge (library): dragging right widens. On the left edge (right column): dragging left widens.
  const sign = edge === "right" ? 1 : -1;
  const spec = COLUMNS[column];

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(event.clientX - d.startX) < 2) return;
    d.moved = true;
    setWidth(column, d.startWidth + sign * (event.clientX - d.startX));
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    // A click (or the first half of a double-click) is not a resize.
    if (d.moved) commit(column);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const dir = event.key === "ArrowRight" ? 1 : -1;
      setWidth(column, width + dir * sign * step);
      commit(column);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("layout.resize")}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      aria-valuenow={width}
      tabIndex={0}
      title={t("layout.resizeHint")}
      data-resize-handle={column}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => reset(column)}
      onKeyDown={onKeyDown}
      className={`group absolute top-0 bottom-0 z-20 w-1.5 cursor-col-resize touch-none outline-none ${
        edge === "right" ? "-right-[3px]" : "-left-[3px]"
      }`}
    >
      <div className="mx-auto h-full w-px bg-transparent transition-colors duration-100 group-hover:bg-accent-line group-focus-visible:bg-accent group-active:bg-accent" />
    </div>
  );
}
