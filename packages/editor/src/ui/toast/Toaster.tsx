import { useEffect, useState, type CSSProperties } from "react";

import { t } from "../../i18n";
import { CANVAS_HOST_ATTR } from "../canvas/canvasHandle";
import { Button, IconButton } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { useToastStore, type Toast, type ToastKind } from "./toastStore";

const ICON: Record<ToastKind, IconName> = {
  info: "info",
  success: "check",
  warning: "warning",
  error: "alert",
};

const ICON_COLOR: Record<ToastKind, string> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  error: "text-danger",
};

/** Gap between the toast stack and the bottom edge it sits on (CSS px). */
const EDGE_GAP = 12;

/**
 * Where the stack goes: bottom-centre of the map canvas, 12 px above its
 * bottom edge (which is the status bar when the dock is collapsed), so the
 * dock below stays usable. Without a canvas (welcome screen) the stack sits
 * 12 px above the status bar, centred in the window (the class fallback).
 */
function useCanvasBottom(active: boolean): CSSProperties | undefined {
  const [place, setPlace] = useState<CSSProperties | undefined>(undefined);
  useEffect(() => {
    if (!active) return;
    let timer = 0;
    const measure = () => {
      const host = document.querySelector(`[${CANVAS_HOST_ATTR}]`);
      const r = host?.getBoundingClientRect();
      const next =
        r && r.width > 0 && r.height > 0
          ? { left: Math.round(r.left + r.width / 2), bottom: Math.round(window.innerHeight - r.bottom + EDGE_GAP), maxWidth: Math.max(0, Math.round(r.width - 32)) }
          : undefined;
      setPlace((c) => (c?.left === next?.left && c?.bottom === next?.bottom && c?.maxWidth === next?.maxWidth ? c : next));
    };
    const loop = () => {
      measure();
      timer = window.setTimeout(loop, 250);
    };
    loop();
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
    };
  }, [active]);
  return active ? place : undefined;
}

/**
 * One-line notifications, bottom-centre. Only the buttons take the pointer:
 * a stroke that runs under a toast keeps drawing (the toast pauses while a
 * button is hovered).
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const place = useCanvasBottom(toasts.length > 0);
  return (
    <div
      aria-live="polite"
      data-toaster
      style={place}
      className="pointer-events-none fixed bottom-[calc(var(--spacing-statusbar)+12px)] left-1/2 z-50 flex w-dialog-m max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col items-center gap-2"
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
    if (paused || toast.duration <= 0 || !Number.isFinite(toast.duration)) return;
    const timer = window.setTimeout(() => dismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [paused, toast.id, toast.duration, dismiss]);

  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className={`pointer-events-none flex h-8 max-w-full items-center gap-2 rounded-md border border-line-strong bg-popup px-3 text-sm text-text shadow-popup transition-[opacity,translate] duration-(--duration-ui) ease-(--ease-out) motion-reduce:transition-none ${
        shown ? "translate-y-0 opacity-100" : "translate-y-0.5 opacity-0"
      }`}
    >
      <Icon name={ICON[toast.kind]} size={16} className={`shrink-0 ${ICON_COLOR[toast.kind]}`} />
      <p title={toast.message} className="min-w-0 flex-1 truncate">{toast.message}</p>
      <span className="pointer-events-auto flex shrink-0 items-center gap-1" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
        {action && (
          <Button
            variant="ghost"
            size="sm"
            disabled={!enabled}
            onClick={() => {
              if (action.enabled && !action.enabled()) {
                setEnabled(false);
                return;
              }
              dismiss(toast.id);
              action.run();
            }}
            className="hover:bg-hover-popup"
          >
            {action.label}
          </Button>
        )}
        <IconButton
          size="sm"
          aria-label={t("toast.dismiss")}
          onClick={() => dismiss(toast.id)}
          className="hover:bg-hover-popup"
        >
          <Icon name="x" size={16} />
        </IconButton>
      </span>
    </div>
  );
}
