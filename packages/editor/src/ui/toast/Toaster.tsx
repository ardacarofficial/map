import { useEffect, useState } from "react";

import { t } from "../../i18n";
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

/**
 * One-line notifications, bottom-centre. Only the buttons take the pointer:
 * a stroke that runs under a toast keeps drawing (the toast pauses while a
 * button is hovered).
 */
export function Toaster({ canvas = false }: { canvas?: boolean }) {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      data-toaster
      className={`pointer-events-none flex-col items-center gap-2 ${toasts.length === 0 ? "hidden" : "flex"} ${canvas ? "max-w-full" : "fixed bottom-3 left-1/2 z-20 w-dialog-m max-w-[calc(100vw-24px)] -translate-x-1/2"}`}
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
