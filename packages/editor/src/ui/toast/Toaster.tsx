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
 * Where the stack goes: the bottom-left corner of the map canvas (above the
 * recent tiles strip, right of the library column), or the window's
 * bottom-left corner when no canvas is shown (welcome screen).
 */
function useCanvasCorner(active: boolean): CSSProperties | undefined {
  const [corner, setCorner] = useState<CSSProperties | undefined>(undefined);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const measure = () => {
      const host = document.querySelector(`[${CANVAS_HOST_ATTR}]`);
      const r = host?.getBoundingClientRect();
      const next = r && r.width > 0 && r.height > 0 ? { left: Math.round(r.left + 16), bottom: Math.round(window.innerHeight - r.bottom + 12) } : undefined;
      setCorner((c) => (c?.left === next?.left && c?.bottom === next?.bottom ? c : next));
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

/** Stack of auto-dismissing notifications at the canvas' bottom-left (the minimap owns its bottom-right corner). */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const corner = useCanvasCorner(toasts.length > 0);
  return (
    <div
      aria-live="polite"
      data-toaster
      style={corner}
      className="pointer-events-none fixed bottom-[calc(var(--spacing-statusbar)+var(--spacing-recentstrip)+12px)] left-[calc(var(--spacing-rail)+16px)] z-50 flex w-[360px] max-w-[calc(100vw-32px)] flex-col items-start gap-2"
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
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      className={`pointer-events-auto flex w-full items-start gap-2.5 rounded-lg border border-line bg-popup py-2.5 pr-2 pl-3 text-md text-text shadow-toast transition-[opacity,translate] duration-200 ease-(--ease-out) ${
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <Icon name={ICON[toast.kind]} size={16} className={`mt-0.5 shrink-0 ${ICON_COLOR[toast.kind]}`} />
      <p className="min-w-0 flex-1 py-px break-words select-text">{toast.message}</p>
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
          className="-my-0.5 h-6 shrink-0 rounded-sm px-2 text-md font-medium text-accent enabled:hover:bg-accent-soft disabled:cursor-default disabled:text-faint"
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
    </div>
  );
}
