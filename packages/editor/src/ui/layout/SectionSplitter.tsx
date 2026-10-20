import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { t } from "../../i18n";
import { useLayoutStore } from "./layoutStore";
import { SECTION_MIN, splitterTarget, type SectionId } from "./sections";

/**
 * Horizontal drag handle between two open sections of the right column.
 * It resizes the section that is not the filler (see `splitterTarget`):
 * drag to resize (clamped, stored on release), double-click back to the
 * pre-resize height, arrow keys nudge it when focused.
 */
export function SectionSplitter({
  above,
  below,
  filler,
  measure,
  clamp,
}: {
  above: SectionId;
  below: SectionId;
  filler: SectionId | null;
  /** Current rendered height of a section (CSS px). */
  measure(id: SectionId): number;
  /** Keeps a height inside the section's limits for the current column. */
  clamp(id: SectionId, height: number): number;
}) {
  const setHeight = useLayoutStore((s) => s.setSectionHeight);
  const { section, sign } = splitterTarget(above, below, filler);
  const drag = useRef<{ startY: number; startHeight: number; moved: boolean } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startHeight: measure(section), moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(event.clientY - d.startY) < 2) return;
    d.moved = true;
    setHeight(section, clamp(section, d.startHeight + sign * (event.clientY - d.startY)), false, d.startHeight);
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.moved) useLayoutStore.getState().commitSections();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const step = (event.shiftKey ? 48 : 16) * (event.key === "ArrowDown" ? 1 : -1) * sign;
    const height = measure(section);
    setHeight(section, clamp(section, height + step), true, height);
  };

  return (
    <div className="relative h-0 shrink-0">
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("inspector.resizeSection")}
        aria-valuemin={SECTION_MIN[section]}
        tabIndex={0}
        title={t("inspector.resizeSectionHint")}
        data-section-splitter={`${above}:${below}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onDoubleClick={() => useLayoutStore.getState().resetSectionHeight(section)}
        onKeyDown={onKeyDown}
        className="group absolute inset-x-0 top-0 z-(--overlay-chrome-raised) flex h-2 -translate-y-1/2 items-center cursor-row-resize touch-none outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent)]"
      >
        <div className="h-px w-full bg-line transition-colors duration-100 group-hover:bg-accent-line group-focus-visible:bg-accent-line group-active:bg-accent-line" />
      </div>
    </div>
  );
}
