import { useEffect, useRef } from "react";

import { mountCanvas } from "../../canvas";
import { t } from "../../i18n";
import { toast } from "../toast/toastStore";
import { CANVAS_HOST_ATTR, setCanvasHandle } from "./canvasHandle";

/**
 * Hosts the PixiJS canvas. `mountCanvas` is async, so an unmount (StrictMode
 * runs effects twice in development) can happen before it resolves; the
 * handle is then destroyed as soon as it arrives.
 */
export function CanvasHost() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let disposed = false;
    let handle: Awaited<ReturnType<typeof mountCanvas>> | null = null;

    mountCanvas(container).then(
      (h) => {
        if (disposed) {
          h.destroy();
          return;
        }
        handle = h;
        setCanvasHandle(h);
      },
      (error: unknown) => {
        if (disposed) return;
        console.error(error);
        toast.error(t("toast.canvasFailed", { detail: error instanceof Error ? error.message : String(error) }));
      },
    );

    return () => {
      disposed = true;
      if (handle) {
        setCanvasHandle(null);
        handle.destroy();
        handle = null;
      }
    };
  }, []);

  return (
    <div
      ref={ref}
      {...{ [CANVAS_HOST_ATTR]: "" }}
      tabIndex={0}
      // Clicking the canvas focuses it so `Tab` (hide panels) works right away.
      onPointerDown={(e) => e.currentTarget.focus({ preventScroll: true })}
      className="relative h-full w-full overflow-hidden bg-canvas outline-none focus-visible:outline-none"
    />
  );
}
