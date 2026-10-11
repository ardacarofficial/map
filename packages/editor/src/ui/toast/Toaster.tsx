import { useEffect, useState, type CSSProperties } from "react";

import { t } from "../../i18n";
import { CANVAS_HOST_ATTR } from "../canvas/canvasHandle";
import { Icon, type IconName } from "../primitives/Icon";
import { useToastStore, type Toast, type ToastKind } from "./toastStore";

const ICON: Record<ToastKind, IconName> = {
  info: "info",
  success: "check",
  warning: "warning",
  error: "alert",
};

const ICON_COLOR: Record<ToastKind, string> = {
  info: "text-accent",
  success: "text-success",
  warning: "text-warning",
  error: "text-danger",
};

/**
 * Where the stack goes: the top-right corner of the map canvas, just under
 * the ruler (away from the centre where the map is drawn, clear of the
 * minimap and the undo pill at the bottom), or the window's top-right
 * corner when no canvas is shown (welcome screen).
 */
function useCanvasCorner(active: boolean): CSSProperties | undefined {
  const [corner, setCorner] = useState<CSSProperties | undefined>(undefined);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const measure = () => {
      const host = document.querySelector(`[${CANVAS_HOST_ATTR}]`);
      const r = host?.getBoundingClientRect();
      const next = r && r.width > 0 && r.height > 0 ? { right: Math.round(window.innerWidth - r.right + 12), top: Math.round(r.top + 28) } : undefined;
      setCorner((c) => (c?.right === next?.right && c?.top === next?.top ? c : next));
    };
    const loop = () => {
      measure();
      frame = window.setTimeout(loop, 250);
    };
    loop();
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(frame);
      window.removeEventListener("resize", measure);
    };
  }, [active]);
  return active ? corner : undefined;
}

/**
 * Stack of auto-dismissing notifications at the canvas' top-right corner. Only
 * the buttons take the pointer: a stroke that runs under a toast keeps
 * drawing (the toast pauses while a button is hovered).
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const corner = useCanvasCorner(toasts.length > 0);
  return (
    <div
      aria-live="polite"
      data-toaster
      style={corner}
      className="pointer-events-none fixed top-4 right-4 z-50 flex w-[340px] max-w-[calc(100vw-32px)] flex-col items-end gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const [paused, setPaused] = useState(false);
  const [shown, setShown] = useState(false);
  const action = toast.action;
  const [enabled, setEnabled] = useState(() => action?.enabled?.() ?? true);

  useEffect(() => {
    if (!action) return;
    setEnabled(action.enabled?.() ?? true);
    return action.watch?.(() => setEnabled(action.enabled?.() ?? true));
  }, [action]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => dismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [paused, toast.id, toast.duration, dismiss]);

  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className={`pointer-events-none flex w-full items-start gap-2.5 rounded-lg border border-line bg-popup py-2.5 pr-2 pl-3 text-md text-text shadow-toast transition-[opacity,translate] duration-200 ease-(--ease-out) ${
        shown ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
      }`}
    >
      <Icon name={ICON[toast.kind]} size={16} className={`mt-0.5 shrink-0 ${ICON_COLOR[toast.kind]}`} />
      <p className="min-w-0 flex-1 py-px break-words">{toast.message}</p>
      <span className="pointer-events-auto -my-0.5 flex shrink-0 items-center gap-0.5" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
      {action && (
        <button
          type="button"
          disabled={!enabled}
          onClick={() => {
            if (action.enabled && !action.enabled()) {
              setEnabled(false);
              return;
            }
            dismiss(toast.id);
            action.run();
          }}
          className="h-6 shrink-0 rounded-sm px-2 text-md font-medium text-accent enabled:hover:bg-accent-soft disabled:cursor-default disabled:text-faint"
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        aria-label={t("toast.dismiss")}
        onClick={() => dismiss(toast.id)}
        className="grid size-6 shrink-0 place-items-center rounded-sm text-faint hover:bg-hover hover:text-text"
      >
        <Icon name="x" size={14} />
      </button>
      </span>
    </div>
  );
}
