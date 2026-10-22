import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { useTilesetView } from "../tilesetViewStore";
import type { PanDrag } from "../usePanDrag";
import { scrollProjection } from "../viewportModel";

/** Native scrollbars and hand panning project the same remembered content origin. */
export function StackViewport({ viewportRef, size, contentWidth, label, shown, pan, children }: {
  viewportRef: RefObject<HTMLDivElement | null>;
  size: { readonly width: number; readonly height: number };
  contentWidth: number;
  label: string;
  shown: string;
  pan: PanDrag;
  children: ReactNode;
}) {
  const offset = useTilesetView(s => s.stackOffset);
  const projection = scrollProjection(offset, size, window.devicePixelRatio || 1);
  const sync = useRef({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || !el.clientWidth || !el.clientHeight) return;
    el.scrollLeft = projection.scrollLeft;
    el.scrollTop = projection.scrollTop;
    sync.current = { left: el.scrollLeft, top: el.scrollTop };
  });
  return <div ref={viewportRef} tabIndex={0} role="region" aria-label={label}
    data-tileset-viewport data-tileset-scroll data-tileset-view="all" data-tileset-shown={shown}
    className={`relative min-h-0 min-w-0 flex-1 overflow-auto bg-bg/40 outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-line)] ${pan.cursor}`}
    {...pan.handlers}
    onScroll={e => {
      const el = e.currentTarget;
      if (!el.clientWidth || !el.clientHeight || el.clientWidth !== size.width || el.clientHeight !== size.height) return;
      if (el.scrollLeft === sync.current.left && el.scrollTop === sync.current.top) return;
      const current = useTilesetView.getState().stackOffset;
      useTilesetView.getState().setStackOffset({ x: current.x + sync.current.left - el.scrollLeft, y: current.y + sync.current.top - el.scrollTop });
      sync.current = { left: el.scrollLeft, top: el.scrollTop };
    }}>
    <div style={{ width: projection.origin.x + contentWidth + size.width, paddingLeft: projection.origin.x, paddingTop: projection.origin.y, paddingRight: size.width, paddingBottom: size.height }}>
      <div style={{ width: size.width }}>{children}</div>
    </div>
  </div>;
}
