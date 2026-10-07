import { useEffect, useState } from "react";

import { t } from "../../i18n";
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

/** Bottom-right stack of auto-dismissing notifications. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-[calc(var(--spacing-statusbar)+12px)] z-50 flex w-[360px] max-w-[calc(100vw-32px)] flex-col items-end gap-2"
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
      className={`pointer-events-auto flex w-full items-start gap-2.5 rounded-lg border border-line bg-raised py-2.5 pr-2 pl-3 text-md text-text shadow-toast transition-[opacity,translate] duration-200 ease-(--ease-out) ${
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <Icon name={ICON[toast.kind]} size={16} className={`mt-0.5 shrink-0 ${ICON_COLOR[toast.kind]}`} />
      <p className="min-w-0 flex-1 py-px break-words select-text">{toast.message}</p>
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
