import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTilesetView } from "../tilesetViewStore";
import { usePanDrag } from "../usePanDrag";
import { panViewport, snapOrigin, wheelScale, zoomViewport, type ViewportTransform } from "../viewportModel";
import { PAN_GESTURE_MS, tilesetWheel } from "../zoomModel";
import { GridHostContext, type GridHost } from "./gridHost";

export const INITIAL_VIEW: ViewportTransform = { x: 8, y: 8, scale: 1 };

/** One transform owner. Native scrollbars are a projection of this same transform. */
export function SingleViewport({ sourceKey, label, width, height, children }: {
  sourceKey: string; label: string; width: number; height: number;
  children(scale: number): ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const transform = useTilesetView(s => s.transforms[sourceKey]) ?? INITIAL_VIEW;
  const [size, setSize] = useState({ width: 1, height: 1 });
  const get = () => useTilesetView.getState().transforms[sourceKey] ?? INITIAL_VIEW;
  const set = (v: ViewportTransform) => useTilesetView.getState().setTransform(sourceKey, v);
  const pan = usePanDrag(ref, (dx, dy) => set(panViewport(get(), dx, dy)));
  const panRef = useRef(pan);
  panRef.current = pan;
  const handlers = useRef(new Map<string, (e: KeyboardEvent) => boolean>());
  const viewportRect = ref.current?.getBoundingClientRect();
  const screen = snapOrigin({ ...transform, x: transform.x + (viewportRect?.left ?? 0), y: transform.y + (viewportRect?.top ?? 0) }, window.devicePixelRatio || 1);
  const projected = { ...screen, x: screen.x - (viewportRect?.left ?? 0), y: screen.y - (viewportRect?.top ?? 0) };
  const origin = { x: Math.max(size.width, projected.x), y: Math.max(size.height, projected.y) };
  const sync = useRef({ left: 0, top: 0 });
  // Children hit-test in their layout effects before this owner's layout effect.
  // Project the final screen origin immediately, then synchronize the scrollbar projection below.
  const contentPosition = { left: (ref.current?.scrollLeft ?? 0) + projected.x, top: (ref.current?.scrollTop ?? 0) + projected.y };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollLeft = origin.x - projected.x;
    el.scrollTop = origin.y - projected.y;
    sync.current = { left: el.scrollLeft, top: el.scrollTop };
    // Native scroll offsets may be rounded by the browser. Keep the rendered origin device snapped.
    if (content.current) {
      content.current.style.left = `${el.scrollLeft + projected.x}px`;
      content.current.style.top = `${el.scrollTop + projected.y}px`;
    }
  });
  const host = useMemo((): GridHost => ({
    focus: () => { useTilesetView.getState().focusSource(sourceKey); ref.current?.focus({ preventScroll: true }); },
    panning: () => panRef.current.active(),
    registerKeys: (key, handler) => { if (handler) handlers.current.set(key, handler); else handlers.current.delete(key); },
    reveal: (grid, box, center) => {
      const vp = ref.current;
      if (!vp) return;
      const r = grid.getBoundingClientRect(), v = vp.getBoundingClientRect();
      const left = r.left - v.left + box.left, top = r.top - v.top + box.top;
      const right = r.left - v.left + box.right, bottom = r.top - v.top + box.bottom;
      if (left >= 0 && top >= 0 && right <= vp.clientWidth && bottom <= vp.clientHeight) return;
      const current = useTilesetView.getState().transforms[sourceKey] ?? INITIAL_VIEW;
      const dx = center ? vp.clientWidth / 2 - (left + right) / 2 : left < 0 ? -left : Math.min(0, vp.clientWidth - right);
      const dy = center ? vp.clientHeight / 2 - (top + bottom) / 2 : top < 0 ? -top : Math.min(0, vp.clientHeight - bottom);
      useTilesetView.getState().setTransform(sourceKey, panViewport(current, dx, dy));
    },
    lazy: false,
    sourcePixels: !sourceKey.startsWith("palette:"),
  }), [sourceKey]);
  const wheel = useRef<(e: WheelEvent) => void>(() => undefined);
  const lastPan = useRef(-Infinity);
  wheel.current = e => {
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const action = tilesetWheel(e, performance.now() - lastPan.current < PAN_GESTURE_MS);
    if (action.kind === "pan") {
      lastPan.current = performance.now();
      set(panViewport(get(), -action.dx, -action.dy));
    } else {
      const r = el.getBoundingClientRect();
      const current = get();
      set(zoomViewport(current, wheelScale(current.scale, action.delta), e.clientX - r.left, e.clientY - r.top));
    }
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (e: WheelEvent) => wheel.current(e);
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, []);
  return <GridHostContext.Provider value={host}>
    <div ref={ref} tabIndex={0} role="grid" aria-label={label} aria-multiselectable
      data-tileset-viewport data-tileset-scroll data-tileset-view="single" data-tileset-shown={sourceKey}
      className={`relative min-h-0 min-w-0 flex-1 overflow-auto bg-bg/40 outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-line)] ${pan.cursor}`}
      {...pan.handlers}
      onScroll={e => {
        const el = e.currentTarget;
        if (el.scrollLeft === sync.current.left && el.scrollTop === sync.current.top) return;
        const current = get();
        set(panViewport(current, sync.current.left - el.scrollLeft, sync.current.top - el.scrollTop));
        sync.current = { left: el.scrollLeft, top: el.scrollTop };
      }}
      onKeyDown={e => {
        if ((e.target as HTMLElement).closest("input,textarea")) return;
        if (handlers.current.get(sourceKey)?.(e)) { e.preventDefault(); e.stopPropagation(); }
      }}>
      <div className="relative" style={{ width: origin.x + width * transform.scale + size.width, height: origin.y + height * transform.scale + size.height }}>
        <div ref={content} className="absolute" style={contentPosition}>{children(transform.scale)}</div>
      </div>
    </div>
  </GridHostContext.Provider>;
}
