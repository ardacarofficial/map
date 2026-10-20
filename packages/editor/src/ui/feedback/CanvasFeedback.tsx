import { useContext, useLayoutEffect, useRef } from "react";

import { ActiveModalScope } from "../primitives/OverlayLifecycle";
import { Toaster } from "../toast/Toaster";
import { feedbackPlacement } from "./feedbackLayout";
import { UndoHud } from "./UndoHud";

/** One stack in the canvas, with enough room on its right for the minimap. */
export function CanvasFeedback() {
  const modal = useContext(ActiveModalScope);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const stack = ref.current;
    const canvas = stack?.parentElement;
    if (!stack || !canvas) return;
    let frame = 0;
    let minimap: HTMLElement | null = null;
    const measure = () => {
      const nextMinimap = canvas.querySelector<HTMLElement>("[data-minimap]");
      if (minimap !== nextMinimap) {
        if (minimap) resize.unobserve(minimap);
        minimap = nextMinimap;
        if (minimap) resize.observe(minimap);
      }
      const rect = canvas.getBoundingClientRect();
      const mini = minimap?.getBoundingClientRect();
      const minimapLeft = mini && mini.width > 0 ? mini.left - rect.left : undefined;
      const { maxWidth } = feedbackPlacement(rect.width, 0, minimapLeft);
      const aboveMinimap = mini && minimapLeft !== undefined && maxWidth > minimapLeft - 20;
      const bottom = aboveMinimap ? rect.bottom - mini.top + 8 : 12;
      stack.style.bottom = `${bottom}px`;
      stack.style.setProperty('--feedback-max-height', `${Math.max(0, rect.height - bottom - 12)}px`);
      stack.style.maxWidth = `min(var(--spacing-dialog-m), ${maxWidth}px)`;
      const { center } = feedbackPlacement(rect.width, stack.getBoundingClientRect().width, minimapLeft);
      stack.style.left = `${center}px`;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(canvas);
    resize.observe(stack);
    // The canvas loads asynchronously; its minimap can be added, resized or hidden later.
    const mutations = new MutationObserver(schedule);
    const host = canvas.querySelector("[data-canvas-host]");
    if (host) mutations.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
    };
  }, []);

  return (
    <div ref={ref} data-canvas-feedback="" style={{ visibility: modal ? "hidden" : undefined }} className="pointer-events-none absolute bottom-3 left-1/2 z-(--overlay-toast) flex w-max max-w-dialog-m -translate-x-1/2 flex-col items-center gap-2">
      <UndoHud />
      <Toaster canvas />
    </div>
  );
}
