import { AlertDialog } from "../primitives/Overlays";
import { Dialog } from "../primitives/Overlays";
import { useEffect, useRef, useState, type ComponentProps, type HTMLAttributes, type ReactNode } from "react";

import { Tooltip } from "../primitives/Tooltip";
import { Toaster } from "../toast/Toaster";
import { t } from "../../i18n";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Toggle } from "../primitives/Toggle";

export const dialogLayoutClass = "flex max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden";

export function DialogHeader({ title, subtitle, onClose, alert = false }: { title: ReactNode; subtitle?: ReactNode; onClose(): void; alert?: boolean }) {
  const headerRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const body = headerRef.current?.parentElement?.querySelector<HTMLElement>("[data-dialog-body]");
    if (!body) return;
    const update = () => setScrolled(body.scrollTop > 0);
    update();
    body.addEventListener("scroll", update, { passive: true });
    return () => body.removeEventListener("scroll", update);
  }, []);

  const Title = alert ? AlertDialog.Title : Dialog.Title;
  const Description = alert ? AlertDialog.Description : Dialog.Description;
  return (
    <header ref={headerRef} className={`flex shrink-0 items-start gap-3 border-b px-4 pt-4 pb-3 ${scrolled ? "border-line-subtle" : "border-transparent"}`}>
      <div className="min-w-0 flex-1">
        <Title className="text-lg font-semibold text-title">{title}</Title>
        {subtitle && <Description title={typeof subtitle === "string" ? subtitle : undefined} className="mt-1 truncate text-md text-muted">{subtitle}</Description>}
      </div>
      <Tooltip label={t("common.close")} side="right"><IconButton size="md" aria-label={t("common.close")} onClick={onClose}><Icon name="x" size={16} /></IconButton></Tooltip>
    </header>
  );
}

export function DialogBody({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-dialog-body="" className={`min-h-0 overflow-y-auto px-4 pb-4 ${className}`} />;
}

export function DialogFooter({ children, status, left }: { children: ReactNode; status?: ReactNode; left?: ReactNode }) {
  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line-subtle px-4 py-3">
      <Toaster modal />
      {left ? <div className="min-w-0">{left}</div> : status && <span className="min-w-0 truncate text-sm text-muted">{status}</span>}
      <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
    </footer>
  );
}

export function FormField({ label, htmlFor, children, error, title }: { label: string; htmlFor?: string | undefined; children: ReactNode; error?: ReactNode; title?: string | undefined }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={htmlFor} title={title} className="text-sm text-muted">{label}</label>
      {children}
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}

export function AdvancedDisclosure({ open, onChange, label, children }: { open: boolean; onChange(open: boolean): void; label: string; children: ReactNode }) {
  return <div className="flex flex-col gap-3">
    <button type="button" aria-expanded={open} onClick={() => onChange(!open)} className="flex items-center gap-1.5 self-start text-sm text-muted hover:text-text">
      <Icon name="chevron-right" size={12} className={open ? "rotate-90" : ""} />{label}
    </button>
    {open && <div className="flex flex-col gap-3">{children}</div>}
  </div>;
}

/** Keep the dialog submit as its single accent fill, using the shared switch. */
export function DialogToggle(props: ComponentProps<typeof Toggle>) {
  return <Toggle {...props} className={`data-checked:border-control-border! data-checked:bg-active! [&>span]:data-checked:bg-text! ${props.className ?? ""}`} />;
}
