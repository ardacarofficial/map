/**
 * Hand panning for a scrollable tileset view, as on the map: hold Space
 * (while the pointer is over the view) and drag with the left button, or
 * drag with the middle button. The pan drag is caught in the capture phase,
 * so the tiles underneath never see it.
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { isTypingTarget } from "../../commands/globalShortcuts";

interface PanState {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

export interface PanDrag {
  /** Spread on the scroll element. */
  handlers: {
    onPointerEnter(): void;
    onPointerLeave(): void;
    onPointerDownCapture(e: ReactPointerEvent<HTMLElement>): void;
    onPointerMove(e: ReactPointerEvent<HTMLElement>): void;
    onPointerUp(e: ReactPointerEvent<HTMLElement>): void;
    onPointerCancel(e: ReactPointerEvent<HTMLElement>): void;
    onLostPointerCapture(e: ReactPointerEvent<HTMLElement>): void;
    onMouseDown(e: ReactMouseEvent<HTMLElement>): void;
    onAuxClick(e: ReactMouseEvent<HTMLElement>): void;
  };
  /** Cursor classes for the scroll element (grab while Space is held, grabbing while dragging). */
  cursor: string;
  /** True while Space is held or a pan drag runs (the left button pans, not the tiles). */
  active(): boolean;
}

export function usePanDrag(ref: RefObject<HTMLElement | null>): PanDrag {
  const [space, setSpace] = useState(false);
  const [dragging, setDragging] = useState(false);
  const spaceRef = useRef(false);
  const inside = useRef(false);
  const drag = useRef<PanState | null>(null);

  useEffect(() => {
    const set = (on: boolean) => {
      spaceRef.current = on;
      setSpace(on);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!inside.current && !drag.current) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      if (!spaceRef.current) set(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && spaceRef.current) set(false);
    };
    const onBlur = () => set(false);
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const end = (e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  return {
    handlers: {
      onPointerEnter: () => {
        inside.current = true;
      },
      onPointerLeave: () => {
        inside.current = false;
      },
      onPointerDownCapture: (e) => {
        const el = ref.current;
        if (!el || !(e.button === 1 || (e.button === 0 && spaceRef.current))) return;
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
        setDragging(true);
      },
      onPointerMove: (e) => {
        const d = drag.current;
        const el = ref.current;
        if (!d || !el || d.pointerId !== e.pointerId) return;
        el.scrollLeft = d.left - (e.clientX - d.x);
        el.scrollTop = d.top - (e.clientY - d.y);
      },
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: end,
      // Middle-button autoscroll (Windows) and text selection.
      onMouseDown: (e) => {
        if (e.button === 1) e.preventDefault();
      },
      onAuxClick: (e) => {
        if (e.button === 1) e.preventDefault();
      },
    },
    cursor: dragging ? "cursor-grabbing [&_*]:cursor-grabbing!" : space ? "cursor-grab [&_*]:cursor-grab!" : "",
    active: () => spaceRef.current || drag.current !== null,
  };
}
